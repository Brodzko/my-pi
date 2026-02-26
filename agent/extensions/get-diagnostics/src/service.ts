/**
 * Diagnostics service — orchestrates providers and caches results.
 *
 * Implements the VS Code model: diagnostics are computed proactively on file
 * read/write (via syncDocument) and served from cache on getDiagnostics.
 *
 * Cache invalidation uses a version counter per file:
 * - syncDocument bumps version and starts a background check tagged with that version
 * - Background check stores result only if version still matches (prevents stale data)
 * - getDiagnostics returns cached result only if version matches (cache hit)
 * - Cache miss falls through to live provider call (still fast with warm providers)
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { glob } from "tinyglobby";
import pTimeout, { TimeoutError } from "p-timeout";
import * as R from "remeda";
import type { DiagnosticsProvider } from "./providers/types";
import type { GetDiagnosticsResult, NormalizedDiagnostic, ProviderStatus } from "./types";
import { log } from "./logger";
import { findPrewarmFile } from "./prewarm-discovery";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTICS = 2000;

/**
 * Maximum cached entries per provider. In long sessions the agent may touch
 * hundreds of files; caching all of them wastes memory for files unlikely to
 * be re-checked. When the limit is hit, the oldest entries (by insertion /
 * last-update order) are evicted.
 */
const MAX_CACHE_ENTRIES_PER_PROVIDER = 200;

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

export type ServiceParams = {
  cwd: string;
  path: string;
  content?: string;
  providers?: string[];
  timeoutMs?: number;
  maxFiles?: number;
};

// --- Diagnostic cache ---

type CachedEntry = {
  diagnostics: NormalizedDiagnostic[];
  version: number;
};

/**
 * Per-provider, per-file diagnostic cache.
 * Outer key: provider id. Inner key: absolute file path.
 */
type DiagnosticCache = Map<string, Map<string, CachedEntry>>;

/**
 * File version tracker. Each syncDocument bumps the version.
 * Background checks tag their results with the version at request time;
 * results are only stored if the version still matches.
 */
type FileVersions = Map<string, number>;

// --- File resolution ---

const resolveFiles = async (
  targetPath: string,
  cwd: string,
  supportedProviders: DiagnosticsProvider[],
  maxFiles: number,
): Promise<{ files: string[]; scanned: number }> => {
  const absPath = path.resolve(cwd, targetPath);
  log("service", "resolveFiles: start", { targetPath, absPath });

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    log("service", "resolveFiles: stat failed, treating as single file", { absPath });
    return { files: [absPath], scanned: 1 };
  }

  if (!stat.isDirectory()) {
    log("service", "resolveFiles: single file", { absPath });
    return { files: [absPath], scanned: 1 };
  }

  // Directory — glob for supported files, derived from provider declarations
  const extensions = R.pipe(
    supportedProviders,
    R.flatMap((p) => [...p.supportedExtensions]),
    R.unique(),
  );

  const patterns = extensions.map((ext) => `**/*.${ext}`);
  log("service", "resolveFiles: globbing directory", { absPath, patterns });

  const t0 = Date.now();
  const files = await glob(patterns, {
    cwd: absPath,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**"],
  });

  log("service", "resolveFiles: glob complete", {
    ms: Date.now() - t0,
    totalFound: files.length,
    capped: files.length > maxFiles,
  });

  return {
    files: files.slice(0, maxFiles),
    scanned: files.length,
  };
};

// --- Sorting and dedup ---

const sortDiagnostics = (diagnostics: NormalizedDiagnostic[]): NormalizedDiagnostic[] =>
  R.pipe(
    diagnostics,
    R.sortBy(
      [(d) => d.path, "asc"],
      [(d) => d.range.start.line, "asc"],
      [(d) => SEVERITY_ORDER[d.severity] ?? 3, "asc"],
    ),
  );

const dedupeDiagnostics = (diagnostics: NormalizedDiagnostic[]): NormalizedDiagnostic[] =>
  R.pipe(
    diagnostics,
    R.uniqueBy(
      (d) =>
        `${d.provider}:${d.path}:${d.range.start.line}:${d.range.start.character}:${d.code ?? ""}:${d.message}`,
    ),
  );

// --- Service ---

export type DiagnosticsService = {
  getDiagnostics: (params: ServiceParams) => Promise<GetDiagnosticsResult>;
  prewarm: (cwd: string) => void;
  syncDocument: (filePath: string, content?: string) => void;
  dispose: () => void;
};

export const createDiagnosticsService = (providers: DiagnosticsProvider[]): DiagnosticsService => {
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const cache: DiagnosticCache = new Map();
  const fileVersions: FileVersions = new Map();

  /** Current cwd — set by prewarm or first getDiagnostics call. */
  let serviceCwd: string | undefined;

  // Initialize cache maps for each provider
  for (const p of providers) {
    cache.set(p.id, new Map());
  }

  /** Get current version for a file, or 0 if never seen. */
  const getVersion = (absPath: string): number => fileVersions.get(absPath) ?? 0;

  /** Bump version for a file. Returns the new version. */
  const bumpVersion = (absPath: string): number => {
    const v = getVersion(absPath) + 1;
    fileVersions.set(absPath, v);
    return v;
  };

  /** Store cached diagnostics if version still matches (not stale). */
  const cacheStore = (
    providerId: string,
    absPath: string,
    version: number,
    diagnostics: NormalizedDiagnostic[],
  ): void => {
    if (getVersion(absPath) !== version) {
      log("service", "cache: stale, discarding", { providerId, file: absPath, version });
      return;
    }
    const providerCache = cache.get(providerId);
    if (!providerCache) return;

    // Delete first so re-insertion moves the key to the end (Map insertion order).
    // This gives us LRU-by-last-update semantics cheaply.
    providerCache.delete(absPath);
    providerCache.set(absPath, { diagnostics, version });

    // Evict oldest entries (first keys in Map iteration order) when over limit
    if (providerCache.size > MAX_CACHE_ENTRIES_PER_PROVIDER) {
      const excess = providerCache.size - MAX_CACHE_ENTRIES_PER_PROVIDER;
      let evicted = 0;
      for (const key of providerCache.keys()) {
        if (evicted >= excess) break;
        providerCache.delete(key);
        evicted++;
      }
      log("service", "cache: evicted LRU entries", { providerId, evicted });
    }
  };

  /** Get cached diagnostics if fresh (version matches). */
  const cacheGet = (providerId: string, absPath: string): NormalizedDiagnostic[] | undefined => {
    const entry = cache.get(providerId)?.get(absPath);
    if (!entry) return undefined;
    if (entry.version !== getVersion(absPath)) return undefined;
    return entry.diagnostics;
  };

  // --- In-flight proactive check tracking ---
  //
  // When proactiveCheck fires for a file, the promise is tracked here.
  // If getDiagnostics is called for the same provider+file while the check
  // is still running, it awaits the existing promise instead of sending a
  // duplicate request. This prevents double-work — especially important for
  // ESLint where @typescript-eslint's Program creation is expensive.
  //
  // Key: "providerId::absPath"
  const inFlight = new Map<string, Promise<NormalizedDiagnostic[]>>();

  const inFlightKey = (providerId: string, absPath: string): string => `${providerId}::${absPath}`;

  /**
   * Run a single provider against a single file and cache the result.
   * Tracks the promise so getDiagnostics can await it instead of duplicating.
   */
  const proactiveCheck = (provider: DiagnosticsProvider, absPath: string, cwd: string): void => {
    if (!provider.isFileSupported(absPath)) return;

    const key = inFlightKey(provider.id, absPath);
    if (inFlight.has(key)) {
      log("service", "proactive check: already in-flight, skipping", {
        provider: provider.id,
        file: absPath,
      });
      return;
    }

    const version = getVersion(absPath);
    log("service", "proactive check: start", { provider: provider.id, file: absPath, version });

    const promise = provider
      .getDiagnostics({ cwd, files: [absPath] })
      .then((diagnostics) => {
        cacheStore(provider.id, absPath, version, diagnostics);
        log("service", "proactive check: cached", {
          provider: provider.id,
          file: absPath,
          version,
          count: diagnostics.length,
        });
        return diagnostics;
      })
      .catch((err) => {
        log("service", "proactive check: error", {
          provider: provider.id,
          file: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as NormalizedDiagnostic[];
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
  };

  // --- Public API ---

  const getDiagnostics = async (params: ServiceParams): Promise<GetDiagnosticsResult> => {
    const startTime = Date.now();
    const userTimeoutMs = params.timeoutMs;
    const maxFiles = params.maxFiles ?? DEFAULT_MAX_FILES;
    serviceCwd ??= params.cwd;

    log("service", "getDiagnostics: start", {
      path: params.path,
      cwd: params.cwd,
      providers: params.providers,
      userTimeoutMs,
      maxFiles,
    });

    // Select providers
    const requestedIds = params.providers ?? ["typescript"];
    const selectedProviders = requestedIds
      .map((id) => providerMap.get(id))
      .filter((p): p is DiagnosticsProvider => p !== undefined);

    log("service", "getDiagnostics: selected providers", {
      requested: requestedIds,
      selected: selectedProviders.map((p) => p.id),
    });

    if (selectedProviders.length === 0) {
      return {
        diagnostics: [],
        providerStatus: {},
        truncated: false,
        scannedFiles: 0,
        processedFiles: 0,
        timingMs: Date.now() - startTime,
      };
    }

    // Resolve files
    const { files, scanned } = await resolveFiles(
      params.path,
      params.cwd,
      selectedProviders,
      maxFiles,
    );

    log("service", "getDiagnostics: files resolved", {
      fileCount: files.length,
      scanned,
      resolveMs: Date.now() - startTime,
    });

    // Run providers in parallel, using cache where available
    const providerStatus: Record<string, ProviderStatus> = {};

    const results = await Promise.allSettled(
      selectedProviders.map(async (provider) => {
        const providerFiles = files.filter((f) => provider.isFileSupported(f));
        if (providerFiles.length === 0) {
          providerStatus[provider.id] = {
            status: "skipped",
            timingMs: 0,
            message: "No supported files",
          };
          log("service", `provider ${provider.id}: skipped (no supported files)`);
          return [];
        }

        const providerStart = Date.now();
        // User-specified timeout wins, then provider's own default, then global default.
        const timeoutMs = userTimeoutMs ?? provider.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

        // Check cache + in-flight for single-file requests (most common case)
        if (providerFiles.length === 1 && params.content === undefined) {
          const absPath = providerFiles[0]!;

          // 1. Cache hit — instant return
          const cached = cacheGet(provider.id, absPath);
          if (cached !== undefined) {
            const ms = Date.now() - providerStart;
            providerStatus[provider.id] = { status: "ok", timingMs: ms };
            log("service", `provider ${provider.id}: cache hit`, {
              file: absPath,
              ms,
              count: cached.length,
            });
            return cached;
          }

          // 2. In-flight proactive check — await it instead of duplicating work.
          //    This is the key optimization: when the agent reads a file, proactiveCheck
          //    fires ESLint in the background. If getDiagnostics arrives before it
          //    completes, we piggyback on the existing request instead of sending
          //    another one that would queue behind it in the serialized worker.
          const key = inFlightKey(provider.id, absPath);
          const inFlightPromise = inFlight.get(key);
          if (inFlightPromise) {
            log("service", `provider ${provider.id}: awaiting in-flight proactive check`, {
              file: absPath,
            });
            const diagnostics = await pTimeout(inFlightPromise, { milliseconds: timeoutMs });
            const ms = Date.now() - providerStart;
            providerStatus[provider.id] = { status: "ok", timingMs: ms };
            log("service", `provider ${provider.id}: in-flight complete`, {
              file: absPath,
              ms,
              count: diagnostics.length,
            });
            return diagnostics;
          }
        }

        log("service", `provider ${provider.id}: starting`, {
          fileCount: providerFiles.length,
        });

        try {
          const diagnostics = await pTimeout(
            provider.getDiagnostics({
              cwd: params.cwd,
              files: providerFiles,
              content: params.content,
              contentPath: params.path,
            }),
            { milliseconds: timeoutMs },
          );

          const providerMs = Date.now() - providerStart;
          providerStatus[provider.id] = { status: "ok", timingMs: providerMs };
          log("service", `provider ${provider.id}: complete`, {
            ms: providerMs,
            diagnosticCount: diagnostics.length,
          });

          // Cache results for single-file requests
          if (providerFiles.length === 1 && params.content === undefined) {
            cacheStore(provider.id, providerFiles[0]!, getVersion(providerFiles[0]!), diagnostics);
          }

          return diagnostics;
        } catch (err) {
          if (err instanceof TimeoutError) {
            providerStatus[provider.id] = {
              status: "timeout",
              timingMs: Date.now() - providerStart,
              message: `Timed out after ${timeoutMs}ms`,
            };
            log("service", `provider ${provider.id}: TIMEOUT`, {
              ms: Date.now() - providerStart,
            });
            return [];
          }
          throw err;
        }
      }),
    );

    const allDiagnostics = R.pipe(
      results.map((result, i) => {
        if (result.status === "fulfilled") return result.value;
        const provider = selectedProviders[i]!;
        providerStatus[provider.id] = {
          status: "error",
          timingMs: 0,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
        log("service", `provider ${provider.id}: REJECTED`, {
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        return [];
      }),
      R.flat(),
    );

    const processed = R.pipe(allDiagnostics, dedupeDiagnostics, sortDiagnostics);
    const truncated = processed.length > MAX_DIAGNOSTICS;
    const diagnostics = truncated ? processed.slice(0, MAX_DIAGNOSTICS) : processed;

    const totalMs = Date.now() - startTime;
    log("service", "getDiagnostics: complete", {
      totalMs,
      diagnosticCount: diagnostics.length,
      truncated,
      providerStatus,
    });

    return {
      diagnostics,
      providerStatus,
      truncated,
      scannedFiles: scanned,
      processedFiles: files.length,
      timingMs: totalMs,
    };
  };

  const prewarm = (cwd: string): void => {
    serviceCwd = cwd;

    // Prewarm ALL providers so each can load its project/program in the
    // background. This is separate from proactive checks (syncDocument) —
    // prewarm is a one-time startup cost, proactive checks are per-edit.
    const file = findPrewarmFile(cwd);
    log("service", "prewarm: delegating to all providers", {
      cwd,
      file: file ?? "(none)",
      providers: providers.map((p) => p.id),
    });

    const options = file ? { file } : undefined;
    for (const provider of providers) {
      provider.prewarm?.(cwd, options);
    }
  };

  const syncDocument = (filePath: string, content?: string): void => {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(serviceCwd ?? "", filePath);
    const version = bumpVersion(absPath);
    log("service", "syncDocument", { file: absPath, version, hasContent: content !== undefined });

    // Delegate to providers (open/reload file in tsserver, etc.)
    for (const provider of providers) {
      provider.syncDocument?.(filePath, content);
    }

    // Proactive background check — fire and forget.
    // Only providers with proactive !== false get background checks on file
    // read/edit. Expensive providers (e.g. ESLint with type-aware rules) are
    // on-demand only to conserve memory — their TS Program only loads when
    // the agent explicitly requests lint.
    if (serviceCwd) {
      for (const provider of providers) {
        if (provider.proactive === false) continue;
        proactiveCheck(provider, absPath, serviceCwd);
      }
    }
  };

  const dispose = (): void => {
    log("service", "dispose: cleaning up");
    for (const provider of providers) {
      provider.dispose?.();
    }
    cache.clear();
    fileVersions.clear();
    inFlight.clear();
  };

  return { getDiagnostics, prewarm, syncDocument, dispose };
};
