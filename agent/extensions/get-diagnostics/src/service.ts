import * as path from "node:path";
import * as fs from "node:fs";
import { glob } from "tinyglobby";
import pTimeout, { TimeoutError } from "p-timeout";
import * as R from "remeda";
import type { DiagnosticsProvider } from "./providers/types";
import type { GetDiagnosticsResult, NormalizedDiagnostic, ProviderStatus } from "./types";
import { log } from "./logger";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTICS = 2000;

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

export type DiagnosticsService = {
  getDiagnostics: (params: ServiceParams) => Promise<GetDiagnosticsResult>;
  prewarm: (cwd: string) => void;
  syncDocument: (filePath: string, content?: string) => void;
  dispose: () => void;
};

export const createDiagnosticsService = (providers: DiagnosticsProvider[]): DiagnosticsService => {
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const getDiagnostics = async (params: ServiceParams): Promise<GetDiagnosticsResult> => {
    const startTime = Date.now();
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxFiles = params.maxFiles ?? DEFAULT_MAX_FILES;

    log("service", "getDiagnostics: start", {
      path: params.path,
      cwd: params.cwd,
      providers: params.providers,
      timeoutMs,
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

    // Run providers in parallel
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

        log("service", `provider ${provider.id}: starting`, { fileCount: providerFiles.length });
        const providerStart = Date.now();

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
    log("service", "prewarm: delegating to providers", { cwd });
    for (const provider of providers) {
      provider.prewarm?.(cwd);
    }
  };

  const syncDocument = (filePath: string, content?: string): void => {
    for (const provider of providers) {
      provider.syncDocument?.(filePath, content);
    }
  };

  const dispose = (): void => {
    log("service", "dispose: cleaning up");
    for (const provider of providers) {
      provider.dispose?.();
    }
  };

  return { getDiagnostics, prewarm, syncDocument, dispose };
};
