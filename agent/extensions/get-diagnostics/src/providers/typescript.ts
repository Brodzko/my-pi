/**
 * TypeScript diagnostics provider using tsserver.
 *
 * tsserver is TypeScript's built-in interactive server — the same one VS Code
 * uses. This ensures diagnostics match exactly what the editor shows:
 * - Correct tsconfig resolution (extends, references, paths)
 * - Incremental checking (only re-checks what changed)
 * - Proper monorepo project discovery
 *
 * Architecture: we spawn `node tsserver.js` as a child process and communicate
 * via its stdin/stdout protocol (Content-Length framed JSON). No worker thread
 * or fork needed — tsserver IS the isolated process.
 *
 * Lifecycle: tsserver is spawned on first use (or prewarm) and stays alive for
 * the entire session. There is no idle timeout — the session owns the lifecycle
 * and calls dispose() on shutdown. This mirrors VS Code's model: tsserver loads
 * the project once at startup, then all subsequent checks are incremental.
 *
 * Concurrency: tsserver is single-threaded and only processes one `geterr` at a
 * time. If a new request arrives while one is in-flight, we queue it and execute
 * after the current request completes. No work is wasted by cancellation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import type { NormalizedDiagnostic, DiagnosticSeverity } from "../types";
import type { DiagnosticsProvider, ProviderParams } from "./types";
import { log } from "../logger";
import { findPrewarmFile } from "../prewarm-discovery";

// --- tsserver protocol types ---

type TsServerDiag = {
  start: { line: number; offset: number };
  end: { line: number; offset: number };
  text: string;
  code: number;
  category: string; // "error" | "warning" | "suggestion"
};

// --- Resolve tsserver from project ---

const resolveTsServerPath = (
  cwd: string,
): { tsserverPath: string; tsVersion: string } | undefined => {
  // Try project's node_modules (createRequire walks up automatically for monorepos)
  try {
    const projectRequire = createRequire(path.join(cwd, "package.json"));
    const tsserverPath = projectRequire.resolve("typescript/lib/tsserver.js");
    const pkgPath = path.join(path.dirname(tsserverPath), "..", "package.json");
    const version = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
    return { tsserverPath, tsVersion: version };
  } catch {
    // Not found in project
  }

  // Fall back to bundled TypeScript
  try {
    const bundledRequire = createRequire(import.meta.url);
    const tsserverPath = bundledRequire.resolve("typescript/lib/tsserver.js");
    const pkgPath = path.join(path.dirname(tsserverPath), "..", "package.json");
    const version = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version as string;
    return { tsserverPath, tsVersion: version };
  } catch {
    return undefined;
  }
};

// --- TsServer process wrapper ---

const CATEGORY_TO_SEVERITY: Record<string, DiagnosticSeverity> = {
  error: "error",
  warning: "warning",
  suggestion: "hint",
};

type GetErrQueueEntry = {
  files: string[];
  resolve: (diags: Map<string, TsServerDiag[]>) => void;
  reject: (err: Error) => void;
};

class TsServer {
  private proc: ChildProcess;
  private seq = 0;
  private buf = Buffer.alloc(0);

  // Response callbacks for request/response commands (configure, etc.)
  private responseCallbacks = new Map<
    number,
    { resolve: (body: unknown) => void; reject: (err: Error) => void }
  >();

  // Active geterr state (only one tracked at a time)
  private getErrState:
    | {
        requestSeq: number;
        diagnostics: Map<string, TsServerDiag[]>;
        resolve: (diags: Map<string, TsServerDiag[]>) => void;
        reject: (err: Error) => void;
      }
    | undefined;

  // Queue for getErr requests that arrive while one is in-flight.
  // tsserver is single-threaded — only one geterr at a time. Instead of
  // cancelling (wasting work), we queue and execute sequentially.
  private getErrQueue: GetErrQueueEntry[] = [];

  // Prewarm geterr tracking (fire-and-forget, but we track completion)
  private prewarmSeq: number | undefined;
  onPrewarmComplete: (() => void) | undefined;
  /** Called when the tsserver process dies unexpectedly (error or non-zero exit). */
  onProcessDeath: ((message: string) => void) | undefined;

  /**
   * Resolves when background project loading (prewarm geterr) completes.
   * Starts resolved (no prewarm pending). `fireGetErr` creates a new pending
   * promise; `requestCompleted` resolves it. getDiagnostics awaits this so
   * the first real call benefits from the fully-loaded project instead of
   * cancelling the prewarm and forcing tsserver to restart checking.
   */
  projectReady: Promise<void> = Promise.resolve();
  private resolveProjectReady: (() => void) | undefined;

  // LRU-ordered open files. Most recently used at the end. When the count
  // exceeds MAX_OPEN_FILES, the least recently used file is closed. This bounds
  // tsserver's content buffer memory — the project graph stays loaded regardless,
  // but each open file holds a source text buffer and priority tracking.
  private static readonly MAX_OPEN_FILES = 50;
  private openFiles = new Map<string, number>(); // file → last-access timestamp
  private alive = true;

  readonly tsVersion: string;
  readonly ready: Promise<void>;

  constructor(
    tsserverPath: string,
    readonly cwd: string,
    tsVersion: string,
  ) {
    this.tsVersion = tsVersion;

    log("tsserver", "starting", { tsserverPath, cwd, tsVersion, pid: process.pid });

    this.proc = spawn(
      "node",
      ["--max-old-space-size=4096", tsserverPath, "--disableAutomaticTypingAcquisition"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Don't keep pi's event loop alive
    this.proc.unref();

    this.proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log("tsserver-stderr", text);
    });
    this.proc.on("error", (err) => {
      log("tsserver", "process error", { error: err.message });
      this.alive = false;
      this.rejectAll(new Error(`tsserver error: ${err.message}`));
      this.onProcessDeath?.(`process error: ${err.message}`);
    });
    this.proc.on("exit", (code, signal) => {
      log("tsserver", "process exited", { code, signal });
      this.alive = false;
      this.rejectAll(new Error(`tsserver exited: code=${code} signal=${signal}`));
      // Only fire onProcessDeath for unexpected exits (not clean shutdown)
      if (code !== 0 && code !== null) {
        this.onProcessDeath?.(`exited with code ${code}`);
      } else if (signal) {
        this.onProcessDeath?.(`killed by ${signal}`);
      }
    });

    // Wait for configure response to confirm server is ready
    this.ready = this.request("configure", {
      hostInfo: "get-diagnostics-extension",
    }).then(() => {
      log("tsserver", "ready", { tsVersion: this.tsVersion, pid: this.proc.pid });
    });
  }

  /**
   * Ensure a file is open with fresh content before checking diagnostics.
   * - New file: open (reads from disk or uses provided content)
   * - Already open: reload from disk, or close+open for content override
   */
  prepareFile(file: string, content?: string): void {
    if (content !== undefined) {
      // Content override: close (if open) + open with fileContent
      if (this.openFiles.has(file)) {
        this.fire("close", { file });
        this.openFiles.delete(file);
      }
      this.fire("open", { file, fileContent: content });
      this.openFiles.set(file, Date.now());
    } else if (this.openFiles.has(file)) {
      // Already open: reload from disk, update access time
      this.fire("reload", { file, tmpfile: file });
      this.openFiles.set(file, Date.now());
    } else {
      // Not open: open (reads from disk)
      this.fire("open", { file });
      this.openFiles.set(file, Date.now());
    }

    this.evictLruFiles();
  }

  /**
   * Close least-recently-used files when over the limit. Frees tsserver's
   * content buffers for files not actively being checked. The project graph
   * stays loaded (tsserver doesn't unload tsconfigs), but each open file
   * holds source text + priority tracking that adds up.
   */
  private evictLruFiles(): void {
    if (this.openFiles.size <= TsServer.MAX_OPEN_FILES) return;

    // Sort by access time (oldest first), evict until under limit
    const entries = [...this.openFiles.entries()].sort((a, b) => a[1] - b[1]);
    const toEvict = entries.slice(0, entries.length - TsServer.MAX_OPEN_FILES);

    for (const [file] of toEvict) {
      log("tsserver", "evicting LRU file", {
        file: path.relative(this.cwd, file),
        openCount: this.openFiles.size,
      });
      this.fire("close", { file });
      this.openFiles.delete(file);
    }
  }

  /**
   * Request diagnostics for files. Files must be prepared (opened) first.
   *
   * If a geterr is already in-flight, the request is queued and executed
   * after the current one completes. tsserver is single-threaded so only
   * one geterr can run at a time — queuing avoids cancelling in-flight work.
   *
   * Caller should await `projectReady` before calling this so the first real
   * request benefits from the prewarmed project.
   */
  getErr(files: string[]): Promise<Map<string, TsServerDiag[]>> {
    if (!this.alive) return Promise.reject(new Error("tsserver not alive"));

    // Cancel any in-flight prewarm geterr (edge case — caller should have
    // awaited projectReady, but handle timeout/race gracefully)
    if (this.prewarmSeq !== undefined) {
      log("tsserver", "cancelling prewarm geterr", { prewarmSeq: this.prewarmSeq });
      this.prewarmSeq = undefined;
      // Resolve projectReady so any other awaiter unblocks
      this.resolveProjectReady?.();
      this.resolveProjectReady = undefined;
      this.onPrewarmComplete = undefined;
    }

    // If a real geterr is already in-flight, queue this request
    if (this.getErrState) {
      log("tsserver", "getErr: queuing (in-flight request active)", {
        queueLength: this.getErrQueue.length + 1,
        files: files.length,
      });
      return new Promise((resolve, reject) => {
        this.getErrQueue.push({ files, resolve, reject });
      });
    }

    return this.executeGetErr(files);
  }

  /**
   * Fire-and-forget geterr for prewarm. Triggers project load in tsserver
   * but doesn't track diagnostic results — only completion.
   *
   * Creates a `projectReady` promise that resolves when the prewarm geterr
   * completes (requestCompleted event). getDiagnostics awaits this so the
   * first real call runs against an already-loaded project.
   *
   * Set `onPrewarmComplete` before calling to get notified when done.
   */
  fireGetErr(files: string[]): void {
    if (!this.alive) return;
    const seq = this.nextSeq();
    this.prewarmSeq = seq;

    // Create a new projectReady promise for this prewarm cycle
    this.projectReady = new Promise<void>((resolve) => {
      this.resolveProjectReady = resolve;
    });

    const msg = JSON.stringify({
      seq,
      type: "request",
      command: "geterr",
      arguments: { files, delay: 0 },
    });
    this.proc.stdin!.write(msg + "\n");
    log("tsserver", "prewarm geterr sent", {
      seq,
      files: files.map((f) => path.relative(this.cwd, f)),
    });
  }

  /** Close a file (tells tsserver to forget cached content). */
  closeFile(file: string): void {
    if (!this.openFiles.has(file)) return;
    this.fire("close", { file });
    this.openFiles.delete(file);
  }

  shutdown(): void {
    log("tsserver", "shutting down", { pid: this.proc.pid });
    this.alive = false;
    this.openFiles.clear();
    // Resolve any pending projectReady so awaiters don't hang
    this.resolveProjectReady?.();
    this.resolveProjectReady = undefined;
    // Reject any queued getErr requests
    for (const entry of this.getErrQueue) {
      entry.reject(new Error("tsserver shutdown"));
    }
    this.getErrQueue = [];
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    this.proc.kill();
    this.rejectAll(new Error("tsserver shutdown"));
  }

  // --- Private: getErr execution ---

  private executeGetErr(files: string[]): Promise<Map<string, TsServerDiag[]>> {
    const seq = this.nextSeq();
    const msg = JSON.stringify({
      seq,
      type: "request",
      command: "geterr",
      arguments: { files, delay: 0 },
    });

    return new Promise((resolve, reject) => {
      const diagnostics = new Map<string, TsServerDiag[]>();
      for (const f of files) diagnostics.set(f, []);

      this.getErrState = { requestSeq: seq, diagnostics, resolve, reject };
      this.proc.stdin!.write(msg + "\n");
    });
  }

  /** Process next queued getErr request, if any. */
  private drainQueue(): void {
    if (this.getErrQueue.length === 0) return;
    const next = this.getErrQueue.shift()!;
    log("tsserver", "drainQueue: executing next", {
      remaining: this.getErrQueue.length,
      files: next.files.length,
    });
    // Prepare files that might not be open yet
    for (const f of next.files) {
      if (!this.openFiles.has(f)) {
        this.prepareFile(f);
      }
    }
    this.executeGetErr(next.files).then(next.resolve).catch(next.reject);
  }

  // --- Private: protocol ---

  private nextSeq(): number {
    return ++this.seq;
  }

  /** Fire-and-forget: send command, don't wait for response. */
  private fire(command: string, args?: unknown): void {
    if (!this.alive) return;
    const seq = this.nextSeq();
    const msg = JSON.stringify({ seq, type: "request", command, arguments: args });
    this.proc.stdin!.write(msg + "\n");
  }

  /** Send command and wait for response. */
  private request(command: string, args?: unknown): Promise<unknown> {
    if (!this.alive) return Promise.reject(new Error("tsserver not alive"));
    const seq = this.nextSeq();
    const msg = JSON.stringify({ seq, type: "request", command, arguments: args });

    return new Promise((resolve, reject) => {
      this.responseCallbacks.set(seq, { resolve, reject });
      this.proc.stdin!.write(msg + "\n");
    });
  }

  // --- Private: stdout parsing (Content-Length framed JSON) ---

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.parseMessages();
  }

  private parseMessages(): void {
    for (;;) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buf.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;

      if (this.buf.length < bodyStart + contentLength) break; // need more data

      const body = this.buf.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
      this.buf = this.buf.subarray(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        this.onMessage(msg);
      } catch {
        log("tsserver", "JSON parse error", { body: body.slice(0, 200) });
      }
    }
  }

  // --- Private: message dispatch ---

  private onMessage(msg: Record<string, unknown>): void {
    if (msg["type"] === "response") {
      const requestSeq = msg["request_seq"] as number;
      const handler = this.responseCallbacks.get(requestSeq);
      if (handler) {
        this.responseCallbacks.delete(requestSeq);
        if (msg["success"]) {
          handler.resolve(msg["body"]);
        } else {
          handler.reject(new Error((msg["message"] as string) ?? "tsserver error"));
        }
      }
      // else: response for fire-and-forget command, ignore
    } else if (msg["type"] === "event") {
      this.onEvent(msg["event"] as string, msg["body"] as Record<string, unknown> | undefined);
    }
  }

  private onEvent(event: string, body: Record<string, unknown> | undefined): void {
    if (!body) return;

    if (event === "syntaxDiag" || event === "semanticDiag" || event === "suggestionDiag") {
      const state = this.getErrState;
      if (!state) return;

      const file = body["file"] as string;
      const diags = (body["diagnostics"] as TsServerDiag[]) ?? [];

      const existing = state.diagnostics.get(file);
      if (existing) {
        existing.push(...diags);
      } else {
        state.diagnostics.set(file, [...diags]);
      }

      log("tsserver", event, { file: path.relative(this.cwd, file), count: diags.length });
    } else if (event === "requestCompleted") {
      const requestSeq = (body["request_seq"] as number) ?? 0;

      // Check if this completes the prewarm geterr
      if (this.prewarmSeq !== undefined && this.prewarmSeq === requestSeq) {
        log("tsserver", "prewarm geterr completed", { seq: requestSeq });
        this.prewarmSeq = undefined;
        // Resolve projectReady — the project is fully loaded
        this.resolveProjectReady?.();
        this.resolveProjectReady = undefined;
        this.onPrewarmComplete?.();
        this.onPrewarmComplete = undefined;
        return;
      }

      // Check if this completes a real geterr
      const state = this.getErrState;
      if (state && state.requestSeq === requestSeq) {
        this.getErrState = undefined;
        state.resolve(state.diagnostics);
        // Process next queued request
        this.drainQueue();
      }
    } else if (event === "projectLoadingStart") {
      log("tsserver", "project loading start", { project: body["projectName"] as string });
    } else if (event === "projectLoadingFinish") {
      log("tsserver", "project loading finish", { project: body["projectName"] as string });
    }
    // Ignore: telemetry, typingsInstallerPid, etc.
  }

  private rejectAll(err: Error): void {
    for (const [, handler] of this.responseCallbacks) {
      handler.reject(err);
    }
    this.responseCallbacks.clear();
    if (this.getErrState) {
      this.getErrState.reject(err);
      this.getErrState = undefined;
    }
    // Reject queued requests too
    for (const entry of this.getErrQueue) {
      entry.reject(err);
    }
    this.getErrQueue = [];
    // Resolve projectReady so any awaiter unblocks on process death
    this.resolveProjectReady?.();
    this.resolveProjectReady = undefined;
  }
}

// --- Provider factory ---

export const createTypescriptProvider = (): DiagnosticsProvider => {
  let server: TsServer | undefined;
  let reportedReady = false;

  const ensureServer = (cwd: string): TsServer => {
    if (server) return server;

    const resolved = resolveTsServerPath(cwd);
    if (!resolved) {
      throw new Error("TypeScript not found. Install typescript in the project.");
    }

    provider.onStatusChange?.({ state: "starting" });
    server = new TsServer(resolved.tsserverPath, cwd, resolved.tsVersion);

    // Track unexpected process death → update status
    server.onProcessDeath = (message) => {
      server = undefined;
      reportedReady = false;
      provider.onStatusChange?.({ state: "error", detail: message });
    };

    return server;
  };

  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);

  const provider: DiagnosticsProvider = {
    id: "typescript",
    supportedExtensions,
    isFileSupported: (filePath: string) => extPattern.test(filePath),
    onPrewarmDone: undefined,
    onStatusChange: undefined,

    async getDiagnostics(params: ProviderParams): Promise<NormalizedDiagnostic[]> {
      const t0 = Date.now();
      log("ts-provider", "getDiagnostics: start", {
        fileCount: params.files.length,
        cwd: params.cwd,
        hasContent: params.content !== undefined,
      });

      const srv = ensureServer(params.cwd);
      await srv.ready;

      // Wait for background project loading (prewarm) to complete before
      // sending our own geterr. If prewarm is done, this resolves immediately.
      // If prewarm is still running, we wait — the project load is the expensive
      // part, and our geterr will be fast once it's done. The service-level
      // pTimeout is the safety net if prewarm takes too long.
      log("ts-provider", "getDiagnostics: awaiting projectReady");
      await srv.projectReady;
      log("ts-provider", "getDiagnostics: projectReady resolved", {
        waitMs: Date.now() - t0,
      });

      // Prepare files and collect absolute paths
      const absFiles = params.files.map((file) => {
        const absPath = path.isAbsolute(file) ? file : path.resolve(params.cwd, file);

        const isContentTarget =
          params.content !== undefined &&
          params.contentPath &&
          path.resolve(params.cwd, params.contentPath) === absPath;

        srv.prepareFile(absPath, isContentTarget ? params.content : undefined);
        return absPath;
      });

      // Request diagnostics — queued if another request is in-flight
      const diagMap = await srv.getErr(absFiles);

      // Normalize tsserver diagnostics → NormalizedDiagnostic[]
      const diagnostics: NormalizedDiagnostic[] = [];
      for (const [file, diags] of diagMap) {
        const relPath = path.relative(params.cwd, file);
        for (const d of diags) {
          diagnostics.push({
            provider: "typescript",
            path: relPath,
            severity: CATEGORY_TO_SEVERITY[d.category] ?? "info",
            message: d.text,
            code: `TS${d.code}`,
            source: "typescript",
            range: {
              start: { line: d.start.line - 1, character: d.start.offset - 1 },
              end: { line: d.end.line - 1, character: d.end.offset - 1 },
            },
          });
        }
      }

      log("ts-provider", "getDiagnostics: complete", {
        totalMs: Date.now() - t0,
        diagnosticCount: diagnostics.length,
      });

      // Transition to "ready" after first successful check — this covers the
      // case where prewarm couldn't find a file (status stayed at "warming").
      if (!reportedReady) {
        reportedReady = true;
        provider.onStatusChange?.({ state: "ready", detail: `TS ${srv.tsVersion}` });
      }

      return diagnostics;
    },

    prewarm(cwd: string, options?: { file?: string }): void {
      log("ts-provider", "prewarm: start", { cwd, hintFile: options?.file });
      const t0 = Date.now();

      const srv = ensureServer(cwd);
      provider.onStatusChange?.({ state: "warming" });

      // Open a file from the project to trigger project load in tsserver.
      // fireGetErr creates a projectReady promise that resolves when tsserver
      // finishes loading the project and type-checking the prewarm file.
      // getDiagnostics awaits projectReady, so the first real call benefits
      // from the fully-loaded project instead of cancelling the prewarm.
      srv.ready
        .then(() => {
          // Use the service-provided file hint if available, otherwise discover
          const file = options?.file ?? findPrewarmFile(cwd);
          if (!file) {
            log("ts-provider", "prewarm: no TS file found in project");
            // Stay in "warming" — we couldn't load the project. The first
            // getDiagnostics call will do the cold load, and we'll transition
            // to "ready" after it completes (see getDiagnostics path below).
            // projectReady stays as the resolved default, so getDiagnostics
            // won't wait (there's nothing to wait for).
            provider.onPrewarmDone?.({
              success: false,
              tsVersion: srv.tsVersion,
              timingMs: Date.now() - t0,
              message: "No TypeScript file found to prewarm",
            });
            return;
          }

          // Open + geterr on ONE file from the most likely project.
          // geterr triggers the full project load AND Program build for that
          // file's tsconfig. We prewarm exactly one project — opening files
          // from multiple packages causes tsserver to load all their tsconfigs
          // serially (30+ seconds in a monorepo), blocking the geterr.
          log("ts-provider", "prewarm: opening file + background geterr", {
            file: path.relative(cwd, file),
          });
          srv.prepareFile(file);

          // Track completion: fire onPrewarmDone when tsserver finishes
          // loading the project (requestCompleted event for the prewarm geterr).
          srv.onPrewarmComplete = () => {
            log("ts-provider", "prewarm: project loaded", {
              file: path.relative(cwd, file),
              totalMs: Date.now() - t0,
              tsVersion: srv.tsVersion,
            });
            reportedReady = true;
            provider.onStatusChange?.({
              state: "ready",
              detail: `TS ${srv.tsVersion}`,
            });
            provider.onPrewarmDone?.({
              success: true,
              tsVersion: srv.tsVersion,
              timingMs: Date.now() - t0,
            });
          };

          srv.fireGetErr([file]);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          log("ts-provider", "prewarm: error", { error: message });
          provider.onStatusChange?.({ state: "error", detail: message });
          provider.onPrewarmDone?.({
            success: false,
            tsVersion: srv.tsVersion,
            message,
            timingMs: Date.now() - t0,
          });
        });
    },

    syncDocument(filePath: string, content?: string): void {
      if (!server) return;
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(server.cwd, filePath);

      if (content !== undefined) {
        // Edit/write with content: close + reopen with new content so tsserver
        // sees the updated source immediately.
        server.closeFile(absPath);
        server.prepareFile(absPath, content);
      } else {
        // Read (no content): just ensure the file is open. If already open,
        // reload from disk to pick up any external changes. Don't close first
        // — that would discard tsserver's cached type information for the file.
        server.prepareFile(absPath);
      }
      // Note: the service layer fires proactiveCheck after syncDocument,
      // which calls getDiagnostics → geterr. That's the background check.
    },

    dispose(): void {
      log("ts-provider", "dispose");
      if (server) {
        // Clear onProcessDeath before shutdown to avoid spurious error status
        server.onProcessDeath = undefined;
        server.shutdown();
        server = undefined;
      }
      provider.onStatusChange?.({ state: "stopped" });
    },
  };

  return provider;
};
