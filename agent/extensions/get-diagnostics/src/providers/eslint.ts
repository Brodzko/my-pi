/**
 * ESLint diagnostics provider.
 *
 * Runs a persistent ESLint server (eslint-server.ts) in a worker thread that
 * manages an ESLint instance with document tracking, modeled after vscode-eslint.
 *
 * - Server keeps ESLint + @typescript-eslint's ProjectService warm
 * - Documents tracked via open/change/close notifications (syncDocument)
 * - Single-file linting uses lintText with tracked content (no disk I/O)
 * - First call is slow (~10-15s, building @typescript-eslint's ts.Program)
 * - Subsequent calls: ~100-500ms (incremental program updates)
 *
 * The server is prewarmed on session start. Even though proactive=false
 * (no background checks on every file edit), the server loads eagerly so
 * the first explicit ESLint request is fast.
 */
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import * as R from "remeda";
import type { NormalizedDiagnostic, DiagnosticSeverity } from "../types";
import type { DiagnosticsProvider, ProviderParams } from "./types";
import { log } from "../logger";
import { createSyncQueue } from "./eslint-sync-queue";

// --- Types ---

type ESLintLintMessage = {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

type ESLintLintResult = {
  filePath: string;
  messages: ESLintLintMessage[];
};

type ServerResponse =
  | { seq: number; success: true; body: Record<string, unknown> }
  | { seq: number; success: false; error: string; timingMs?: number }
  | { event: string; body: Record<string, unknown> };

// --- Result normalization ---

const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: "warning",
  2: "error",
};

const normalizeResults = (results: ESLintLintResult[], cwd: string): NormalizedDiagnostic[] =>
  R.pipe(
    results,
    R.flatMap((result) =>
      result.messages.map(
        (msg): NormalizedDiagnostic => ({
          provider: "eslint",
          path: path.relative(cwd, result.filePath),
          severity: SEVERITY_MAP[msg.severity] ?? "warning",
          message: msg.message,
          code: msg.ruleId ?? undefined,
          source: "eslint",
          range: {
            start: {
              line: Math.max(0, msg.line - 1),
              character: Math.max(0, msg.column - 1),
            },
            end: {
              line: Math.max(0, (msg.endLine ?? msg.line) - 1),
              character: Math.max(0, (msg.endColumn ?? msg.column) - 1),
            },
          },
        }),
      ),
    ),
  );

const makeErrorDiagnostic = (message: string): NormalizedDiagnostic => ({
  provider: "eslint",
  path: "",
  severity: "error",
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

const makeInfoDiagnostic = (message: string): NormalizedDiagnostic => ({
  provider: "eslint",
  path: "",
  severity: "info",
  message,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
});

// --- Provider ---

export const createEslintProvider = (): DiagnosticsProvider => {
  let worker: Worker | undefined;
  let seq = 0;

  // Pending request callbacks keyed by seq
  const pending = new Map<
    number,
    {
      resolve: (body: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();

  // Track files we've sent "open" for so we send "change" on subsequent syncs
  const openFiles = new Set<string>();

  // Buffers syncDocument calls received before server initialization.
  // Replayed immediately after init so the server has document state
  // before the first lint request.
  const syncQueue = createSyncQueue();

  const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "eslint-server.ts");

  let initialized = false;
  let initPromise: Promise<void> | undefined;
  let serverCwd: string | undefined;

  // --- Worker management ---

  const ensureWorker = (): Worker => {
    if (worker) return worker;

    log("eslint-provider", "spawning worker", { serverPath });
    const w = new Worker(serverPath, {
      // pi runs .ts via a loader — the worker needs the same treatment.
      execArgv: process.execArgv,
      // Cap worker heap. @typescript-eslint creates its own ts.Program
      // which can use 1-3GB for large projects.
      resourceLimits: {
        maxOldGenerationSizeMb: 4096,
      },
    });

    w.unref(); // Don't keep pi alive

    w.on("message", (msg: ServerResponse) => {
      // Events (unsolicited server → client)
      if ("event" in msg) {
        if (msg.event === "status") {
          const body = msg.body as { state: string; detail?: string };
          log("eslint-provider", "status event", body);
          provider.onStatusChange?.({
            state: body.state as "starting" | "warming" | "ready" | "error" | "stopped",
            detail: body.detail,
          });
        }
        return;
      }

      // Responses to requests
      const cb = pending.get(msg.seq);
      if (!cb) return;
      pending.delete(msg.seq);

      if (msg.success) {
        cb.resolve(msg.body);
      } else {
        cb.reject(new Error(msg.error));
      }
    });

    w.on("error", (err) => {
      log("eslint-provider", "worker error", { error: err.message });
      provider.onStatusChange?.({ state: "error", detail: err.message });
      for (const [, cb] of pending) {
        cb.reject(err);
      }
      pending.clear();
      worker = undefined;
      initialized = false;
      initPromise = undefined;
    });

    w.on("exit", (code) => {
      log("eslint-provider", "worker exited", { code });
      if (code !== 0) {
        provider.onStatusChange?.({ state: "error", detail: `Worker exited with code ${code}` });
      }
      for (const [, cb] of pending) {
        cb.reject(new Error(`ESLint worker exited with code ${code}`));
      }
      pending.clear();
      worker = undefined;
      openFiles.clear();
      initialized = false;
      initPromise = undefined;
    });

    worker = w;
    return w;
  };

  // --- Communication ---

  const sendNotification = (command: string, args: Record<string, unknown>): void => {
    worker?.postMessage({ command, arguments: args });
  };

  const sendRequest = (
    command: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      if (!worker) {
        reject(new Error("ESLint worker not running"));
        return;
      }
      const id = seq++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ seq: id, command, arguments: args });
    });

  // --- Initialization ---

  /** Replay queued syncDocument calls so the server has document state. */
  const replaySyncQueue = (): void => {
    const entries = syncQueue.drain();
    for (const entry of entries) {
      sendNotification(
        entry.command,
        entry.content !== undefined
          ? { file: entry.file, content: entry.content }
          : { file: entry.file },
      );
      openFiles.add(entry.file);
    }
    if (entries.length > 0) {
      log("eslint-provider", "replayed sync queue", { count: entries.length });
    }
  };

  const ensureInitialized = async (cwd: string): Promise<void> => {
    if (initialized && serverCwd === cwd) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      ensureWorker();
      serverCwd = cwd;
      provider.onStatusChange?.({ state: "starting" });
      await sendRequest("initialize", { cwd });
      initialized = true;
      replaySyncQueue();
      initPromise = undefined;
    })();

    return initPromise;
  };

  // --- Provider implementation ---

  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);

  const provider: DiagnosticsProvider = {
    id: "eslint",
    supportedExtensions,
    defaultTimeoutMs: 120_000,
    proactive: false,
    isFileSupported: (filePath: string) => extPattern.test(filePath),
    onStatusChange: undefined,

    async getDiagnostics(params: ProviderParams): Promise<NormalizedDiagnostic[]> {
      try {
        await ensureInitialized(params.cwd);

        if (params.files.length === 1) {
          // Single file: use lint command → lintText with tracked content.
          // This is the fast path — no disk I/O, incremental program update.
          const file = params.contentPath ?? params.files[0];
          const body = await sendRequest("lint", {
            file,
            ...(params.content !== undefined ? { content: params.content } : {}),
          });
          return normalizeResults(body.results as ESLintLintResult[], params.cwd);
        }

        // Multi-file (directory scan): use lintFiles for ESLint's batch mode.
        const body = await sendRequest("lintFiles", { files: params.files });
        return normalizeResults(body.results as ESLintLintResult[], params.cwd);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === "ESLint not found in project") {
          return [makeInfoDiagnostic("ESLint not found in project. Install with: npm i -D eslint")];
        }
        return [makeErrorDiagnostic(`ESLint error: ${message}`)];
      }
    },

    syncDocument(filePath: string, content?: string): void {
      if (!worker || !initialized) {
        syncQueue.enqueue(filePath, content, !openFiles.has(filePath));
        return;
      }

      if (openFiles.has(filePath)) {
        sendNotification(
          "change",
          content !== undefined ? { file: filePath, content } : { file: filePath },
        );
      } else {
        sendNotification(
          "open",
          content !== undefined ? { file: filePath, content } : { file: filePath },
        );
        openFiles.add(filePath);
      }
    },

    prewarm(cwd: string, options?: { file?: string }): void {
      log("eslint-provider", "prewarm: start", { cwd, hintFile: options?.file });
      provider.onStatusChange?.({ state: "warming" });

      ensureWorker();
      serverCwd = cwd;

      initPromise = (async () => {
        try {
          await sendRequest("initialize", { cwd, file: options?.file });
          initialized = true;
          replaySyncQueue();
          initPromise = undefined;
        } catch (e) {
          log("eslint-provider", "prewarm: error", {
            error: e instanceof Error ? e.message : String(e),
          });
          initPromise = undefined;
        }
      })();
    },

    dispose(): void {
      log("eslint-provider", "dispose");
      if (worker) {
        worker.postMessage({ command: "shutdown" });
        worker = undefined;
      }
      pending.clear();
      openFiles.clear();
      syncQueue.clear();
      initialized = false;
      initPromise = undefined;
      serverCwd = undefined;
      provider.onStatusChange?.({ state: "stopped" });
    },
  };

  return provider;
};
