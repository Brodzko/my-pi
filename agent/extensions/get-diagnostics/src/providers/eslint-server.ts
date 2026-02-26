/**
 * ESLint language server — worker thread.
 *
 * Persistent worker that manages an ESLint instance and open documents,
 * modeled after vscode-eslint's language server architecture.
 *
 * Key design: uses lintText (not lintFiles) for single-file linting, feeding
 * content directly to the parser. This lets @typescript-eslint's ProjectService
 * update its ts.Program incrementally without disk I/O — the same model that
 * makes ESLint diagnostics instant in VSCode.
 *
 * Tracks open documents with their content. syncDocument calls from the
 * provider keep the server in sync with the agent's workspace view.
 *
 * All lint work is serialized — @typescript-eslint's internal ts.createProgram
 * is synchronous and would block concurrent operations. With serialization,
 * the second lint for the same tsconfig finds the Program already warm.
 *
 * Protocol (structured messages over parentPort):
 *
 *   Requests (have seq, expect response):
 *     → { seq, command: "initialize", arguments: { cwd, file? } }
 *     ← { seq, success: true, body: { eslintFound: true } }
 *
 *     → { seq, command: "lint", arguments: { file, content? } }
 *     ← { seq, success: true, body: { results, timingMs } }
 *
 *     → { seq, command: "lintFiles", arguments: { files } }
 *     ← { seq, success: true, body: { results, timingMs } }
 *
 *   Notifications (no seq, fire-and-forget):
 *     → { command: "open", arguments: { file, content? } }
 *     → { command: "change", arguments: { file, content? } }
 *     → { command: "close", arguments: { file } }
 *     → { command: "shutdown" }
 *
 *   Events (server → client, unsolicited):
 *     ← { event: "status", body: { state, detail? } }
 */
import { parentPort } from "node:worker_threads";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";

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

type ESLintInstance = {
  lintFiles: (patterns: string[]) => Promise<ESLintLintResult[]>;
  lintText: (code: string, options?: { filePath?: string }) => Promise<ESLintLintResult[]>;
};

type ESLintConstructor = new (options: { cwd: string }) => ESLintInstance;

// --- Protocol helpers ---

const send = (msg: Record<string, unknown>): void => {
  parentPort!.postMessage(msg);
};

const sendResponse = (seq: number, body: Record<string, unknown>): void => {
  send({ seq, success: true, body });
};

const sendError = (seq: number, error: string, timingMs?: number): void => {
  send({ seq, success: false, error, timingMs });
};

const sendEvent = (event: string, body: Record<string, unknown>): void => {
  send({ event, body });
};

// --- Document tracking ---
// Inlined here because this file runs as a standalone worker.
// The shared DocumentStore module is tested separately via eslint-documents.test.ts.

const documents = new Map<string, string>();

const readFromDisk = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
};

const docOpen = (file: string, content?: string): void => {
  if (content !== undefined) {
    documents.set(file, content);
  } else {
    const disk = readFromDisk(file);
    if (disk !== undefined) documents.set(file, disk);
  }
};

const docChange = (file: string, content?: string): void => {
  if (content !== undefined) {
    documents.set(file, content);
  } else {
    const disk = readFromDisk(file);
    if (disk !== undefined) {
      documents.set(file, disk);
    } else {
      documents.delete(file);
    }
  }
};

const docClose = (file: string): void => {
  documents.delete(file);
};

/** Get content: tracked → disk fallback → undefined. */
const getContent = (file: string): string | undefined => {
  return documents.get(file) ?? readFromDisk(file);
};

// --- ESLint instance ---

let eslint: ESLintInstance | undefined;

const resolveESLint = (cwd: string): ESLintConstructor | undefined => {
  try {
    const req = createRequire(path.join(cwd, "package.json"));
    const eslintPath = req.resolve("eslint");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = req(eslintPath) as { ESLint?: ESLintConstructor };
    return mod.ESLint;
  } catch {
    return undefined;
  }
};

// --- Request queue (serialize all lint work) ---

const queue: Array<() => Promise<void>> = [];
let processing = false;

const processQueue = async (): Promise<void> => {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    await task();
  }
  processing = false;
};

const enqueue = (task: () => Promise<void>): void => {
  queue.push(task);
  void processQueue();
};

// --- Command handlers ---

const handleInitialize = async (seq: number, args: Record<string, unknown>): Promise<void> => {
  const cwd = args.cwd as string;

  const ESLintClass = resolveESLint(cwd);
  if (!ESLintClass) {
    sendError(seq, "ESLint not found in project");
    sendEvent("status", { state: "error", detail: "ESLint not found" });
    return;
  }

  try {
    eslint = new ESLintClass({ cwd });
    sendEvent("status", { state: "warming", detail: "loading config…" });
    sendResponse(seq, { eslintFound: true });

    // Warm up: lint a real file to force @typescript-eslint to build its
    // internal ts.Program. Without this, program creation defers to the
    // first real lint call. With a real file in the right tsconfig scope,
    // the Program is ready for fast incremental updates.
    const warmupFile = args.file as string | undefined;
    const t0 = Date.now();

    if (warmupFile) {
      const content = getContent(warmupFile);
      if (content !== undefined) {
        await eslint.lintText(content, { filePath: warmupFile });
      } else {
        await eslint.lintFiles([warmupFile]);
      }
    } else {
      // No real file — lint empty content to at least load config + plugins
      await eslint.lintText("", { filePath: path.join(cwd, "__warmup__.ts") });
    }

    sendEvent("status", {
      state: "ready",
      detail: `ESLint${warmupFile ? ` (${Date.now() - t0}ms)` : ""}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Don't sendError here — the initialize response was already sent.
    // Status event is enough for the provider to know warmup failed.
    sendEvent("status", { state: "error", detail: message });
  }
};

const handleOpen = (args: Record<string, unknown>): void => {
  const file = args.file as string;
  const content = args.content as string | undefined;
  docOpen(file, content);
};

const handleChange = (args: Record<string, unknown>): void => {
  const file = args.file as string;
  const content = args.content as string | undefined;
  docChange(file, content);
};

const handleClose = (args: Record<string, unknown>): void => {
  const file = args.file as string;
  docClose(file);
};

const handleLint = async (seq: number, args: Record<string, unknown>): Promise<void> => {
  const file = args.file as string;
  const explicitContent = args.content as string | undefined;
  const t0 = Date.now();

  if (!eslint) {
    sendError(seq, "Not initialized", Date.now() - t0);
    return;
  }

  try {
    // Priority: explicit content > tracked document > disk
    const content = explicitContent ?? getContent(file);
    const results =
      content !== undefined
        ? await eslint.lintText(content, { filePath: file })
        : await eslint.lintFiles([file]);

    sendResponse(seq, { results, timingMs: Date.now() - t0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendError(seq, message, Date.now() - t0);
  }
};

const handleLintFiles = async (seq: number, args: Record<string, unknown>): Promise<void> => {
  const files = args.files as string[];
  const t0 = Date.now();

  if (!eslint) {
    sendError(seq, "Not initialized", Date.now() - t0);
    return;
  }

  try {
    const results = await eslint.lintFiles(files);
    sendResponse(seq, { results, timingMs: Date.now() - t0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendError(seq, message, Date.now() - t0);
  }
};

// --- Message dispatch ---

type IncomingMessage = {
  seq?: number;
  command: string;
  arguments?: Record<string, unknown>;
};

const handleMessage = (msg: IncomingMessage): void => {
  if (msg.command === "shutdown") {
    documents.clear();
    process.exit(0);
  }

  const args = msg.arguments ?? {};

  // Notifications (no seq)
  if (msg.seq === undefined) {
    switch (msg.command) {
      case "open":
        handleOpen(args);
        return;
      case "change":
        handleChange(args);
        return;
      case "close":
        handleClose(args);
        return;
    }
    return;
  }

  // Requests (have seq → enqueue for serialized execution)
  const { seq } = msg;
  switch (msg.command) {
    case "initialize":
      enqueue(() => handleInitialize(seq, args));
      break;
    case "lint":
      enqueue(() => handleLint(seq, args));
      break;
    case "lintFiles":
      enqueue(() => handleLintFiles(seq, args));
      break;
    default:
      sendError(seq, `Unknown command: ${msg.command}`);
  }
};

parentPort!.on("message", (msg: IncomingMessage) => {
  handleMessage(msg);
});
