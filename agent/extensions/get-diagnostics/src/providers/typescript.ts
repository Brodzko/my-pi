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
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { globSync } from "tinyglobby";
import type { NormalizedDiagnostic, DiagnosticSeverity } from "../types";
import type { DiagnosticsProvider, ProviderParams, PrewarmDoneInfo } from "./types";
import { log } from "../logger";

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

// --- Find a file for prewarm ---

/**
 * Find a TypeScript file to open during prewarm. Any .ts/.tsx file works —
 * tsserver discovers the project from the file's nearest tsconfig.
 *
 * Uses tinyglobby with common monorepo search paths. Stops at first match.
 */
const findPrewarmFile = (cwd: string): string | undefined => {
  const results = globSync(["**/*.{ts,tsx}"], {
    cwd,
    absolute: true,
    ignore: [
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*e2e*/**",
      "**/__test*/**",
    ],
  });
  return results[0];
};

// --- TsServer process wrapper ---

const IDLE_TIMEOUT_MS = 120_000;

const CATEGORY_TO_SEVERITY: Record<string, DiagnosticSeverity> = {
  error: "error",
  warning: "warning",
  suggestion: "hint",
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

  // Active geterr state (only one tracked at a time — new requests cancel previous)
  private getErrState:
    | {
        requestSeq: number;
        diagnostics: Map<string, TsServerDiag[]>;
        resolve: (diags: Map<string, TsServerDiag[]>) => void;
        reject: (err: Error) => void;
      }
    | undefined;

  // Prewarm geterr tracking (fire-and-forget, but we track completion)
  private prewarmSeq: number | undefined;
  onPrewarmComplete: (() => void) | undefined;

  private openFiles = new Set<string>();
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

    // Lower tsserver's CPU priority so it doesn't starve pi's process.
    // Priority 19 = lowest on Unix (PRIORITY_LOW). The OS scheduler will
    // only give tsserver CPU time when pi is idle.
    if (this.proc.pid) {
      try {
        os.setPriority(this.proc.pid, os.constants.priority.PRIORITY_LOW);
        log("tsserver", "set CPU priority to LOW", { pid: this.proc.pid });
      } catch {
        // Might fail on some platforms — non-critical
      }
    }

    this.proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log("tsserver-stderr", text);
    });
    this.proc.on("error", (err) => {
      log("tsserver", "process error", { error: err.message });
      this.alive = false;
      this.rejectAll(new Error(`tsserver error: ${err.message}`));
    });
    this.proc.on("exit", (code, signal) => {
      log("tsserver", "process exited", { code, signal });
      this.alive = false;
      this.rejectAll(new Error(`tsserver exited: code=${code} signal=${signal}`));
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
      this.openFiles.add(file);
    } else if (this.openFiles.has(file)) {
      // Already open: reload from disk
      this.fire("reload", { file, tmpfile: file });
    } else {
      // Not open: open (reads from disk)
      this.fire("open", { file });
      this.openFiles.add(file);
    }
  }

  /**
   * Request diagnostics for files. Files must be prepared (opened) first.
   * Cancels any in-flight geterr (prewarm or previous). tsserver also cancels
   * the previous geterr internally when it receives a new one.
   */
  getErr(files: string[]): Promise<Map<string, TsServerDiag[]>> {
    if (!this.alive) return Promise.reject(new Error("tsserver not alive"));

    // Cancel any in-flight prewarm geterr
    if (this.prewarmSeq !== undefined) {
      log("tsserver", "cancelling prewarm geterr", { prewarmSeq: this.prewarmSeq });
      this.prewarmSeq = undefined;
      // Don't fire onPrewarmComplete — prewarm was superseded, not completed
      this.onPrewarmComplete = undefined;
    }

    // Cancel any in-flight real geterr
    if (this.getErrState) {
      log("tsserver", "cancelling in-flight geterr", { oldSeq: this.getErrState.requestSeq });
      this.getErrState.reject(new Error("cancelled by new geterr"));
      this.getErrState = undefined;
    }

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

  /**
   * Fire-and-forget geterr for prewarm. Triggers project load in tsserver
   * but doesn't track diagnostic results — only completion.
   * Set `onPrewarmComplete` before calling to get notified when done.
   * If a real getErr arrives while this is running, tsserver cancels this one
   * and the partial project load (Program cache) is reused.
   */
  fireGetErr(files: string[]): void {
    if (!this.alive) return;
    const seq = this.nextSeq();
    this.prewarmSeq = seq;
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
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    this.proc.kill();
    this.rejectAll(new Error("tsserver shutdown"));
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
        this.onPrewarmComplete?.();
        this.onPrewarmComplete = undefined;
        return;
      }

      // Check if this completes a real geterr
      const state = this.getErrState;
      if (state && state.requestSeq === requestSeq) {
        this.getErrState = undefined;
        state.resolve(state.diagnostics);
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
  }
}

// --- Provider factory ---

export const createTypescriptProvider = (): DiagnosticsProvider => {
  let server: TsServer | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (server) {
        log("ts-provider", "idle timeout: shutting down tsserver");
        server.shutdown();
        server = undefined;
      }
    }, IDLE_TIMEOUT_MS);
  };

  const ensureServer = (cwd: string): TsServer => {
    if (server) return server;

    const resolved = resolveTsServerPath(cwd);
    if (!resolved) {
      throw new Error("TypeScript not found. Install typescript in the project.");
    }

    server = new TsServer(resolved.tsserverPath, cwd, resolved.tsVersion);
    return server;
  };

  const supportedExtensions = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join("|")})$`);

  const provider: DiagnosticsProvider = {
    id: "typescript",
    supportedExtensions,
    isFileSupported: (filePath: string) => extPattern.test(filePath),
    onPrewarmDone: undefined,

    async getDiagnostics(params: ProviderParams): Promise<NormalizedDiagnostic[]> {
      const t0 = Date.now();
      log("ts-provider", "getDiagnostics: start", {
        fileCount: params.files.length,
        cwd: params.cwd,
        hasContent: params.content !== undefined,
      });

      const srv = ensureServer(params.cwd);
      await srv.ready;

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

      // Request diagnostics
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

      resetIdleTimer();
      return diagnostics;
    },

    prewarm(cwd: string): void {
      log("ts-provider", "prewarm: start", { cwd });
      const t0 = Date.now();

      const srv = ensureServer(cwd);

      // Open a file from the project to trigger project load in tsserver.
      // This happens in the background — tsserver loads the tsconfig, discovers
      // files, and builds the type graph. When the first real getDiagnostics
      // call comes in, the project is already loaded.
      srv.ready
        .then(() => {
          const file = findPrewarmFile(cwd);
          if (!file) {
            log("ts-provider", "prewarm: no file found to open");
            provider.onPrewarmDone?.({
              success: true,
              tsVersion: srv.tsVersion,
              timingMs: Date.now() - t0,
              message: "No entry file found — first call will be cold",
            });
            return;
          }

          log("ts-provider", "prewarm: opening file + background geterr", { file });
          srv.prepareFile(file);

          // Track completion: fire onPrewarmDone when tsserver finishes
          // loading the project (requestCompleted event), not when we send
          // the command. If a real getDiagnostics cancels this, prewarm is
          // superseded and we don't fire onPrewarmDone.
          srv.onPrewarmComplete = () => {
            log("ts-provider", "prewarm: project loaded", {
              file,
              totalMs: Date.now() - t0,
              tsVersion: srv.tsVersion,
            });
            provider.onPrewarmDone?.({
              success: true,
              tsVersion: srv.tsVersion,
              timingMs: Date.now() - t0,
            });
            resetIdleTimer();
          };

          srv.fireGetErr([file]);
        })
        .catch((err) => {
          log("ts-provider", "prewarm: error", {
            error: err instanceof Error ? err.message : String(err),
          });
          provider.onPrewarmDone?.({
            success: false,
            tsVersion: srv.tsVersion,
            message: err instanceof Error ? err.message : String(err),
            timingMs: Date.now() - t0,
          });
        });
    },

    syncDocument(filePath: string, content?: string): void {
      if (!server) return;
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(server.cwd, filePath);

      // Close so tsserver picks up fresh content on next check.
      // For writes with content, re-open with the new content immediately.
      server.closeFile(absPath);
      if (content !== undefined) {
        server.prepareFile(absPath, content);
      }
    },

    dispose(): void {
      log("ts-provider", "dispose");
      if (server) {
        server.shutdown();
        server = undefined;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },
  };

  return provider;
};
