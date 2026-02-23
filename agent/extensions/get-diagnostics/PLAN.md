# get-diagnostics Extension — Implementation Plan (Final)

## Goal

Instant TypeScript and ESLint diagnostics for files and directories, without
running full `tsc` or `eslint`. Must be fast in large projects (~300k LOC),
non-blocking for pi, and easily extensible to new providers.

## Architecture

**Single package. TypeScript provider runs in a `node:worker_threads` worker
(non-blocking, background prewarm on startup). ESLint uses async Node API
in-process. No daemon, no subprocess, no custom protocol.**

### Why `ts.LanguageService`

| Approach                               | Cold start          | Warm check       | Complexity                          |
| -------------------------------------- | ------------------- | ---------------- | ----------------------------------- |
| `ts.createProgram` per call            | 5-15s every time    | N/A (no caching) | Low                                 |
| `typescript-language-server` (current) | 5-15s (LSP init)    | 100-500ms        | Very high (LSP client, daemon, IPC) |
| **`ts.LanguageService` in worker**     | **0ms (prewarmed)** | **100-500ms**    | **Moderate (worker + postMessage)** |

`ts.LanguageService` is the same API VS Code uses internally. It's designed for
incremental, interactive type-checking:

- First load builds the full type graph (parses tsconfig, resolves all files).
  This is unavoidable — TypeScript must see the whole program to resolve types.
- Subsequent calls reuse the cached program. Only changed files are re-checked.
- `getSemanticDiagnostics(fileName)` and `getSyntacticDiagnostics(fileName)` are
  per-file operations on the cached program — fast.
- The `LanguageServiceHost` interface lets us intercept file reads, so we can
  serve unsaved `content` overrides without touching disk.

### Why a worker thread

TypeScript's compiler API is entirely synchronous. `getSemanticDiagnostics`
blocks the thread it runs on. For warm calls (100-500ms), this is invisible. For
the initial project load (5-15s for ~300k LOC), it would freeze pi's event loop
— no TUI rendering, no input handling.

Running the TS language service in a `node:worker_threads` worker solves this:

- **Non-blocking:** The worker runs on its own V8 isolate and thread. Pi's event
  loop is never blocked.
- **Background prewarm:** On `session_start`, the extension sends a `prewarm`
  message to the worker. The worker creates the language service and loads the
  project. By the time the agent first calls `get_diagnostics`, the project is
  already loaded.
- **Simple IPC:** `postMessage` / `on('message')` with structured clone. No
  JSON-RPC framing, no `Content-Length` headers, no custom protocol. Node
  handles serialization.
- **Crash isolation:** If the TypeScript compiler panics, only the worker dies.
  Pi continues. The worker can be respawned.

Communication protocol (entire thing):

```ts
// Main → Worker
type WorkerRequest =
  | { type: "prewarm"; id: string; cwd: string }
  | {
      type: "getDiagnostics";
      id: string;
      files: string[];
      cwd: string;
      content?: string;
      contentPath?: string;
    }
  | { type: "syncDocument"; filePath: string; content?: string }
  | { type: "dispose" };

// Worker → Main
type WorkerResponse =
  | { type: "result"; id: string; diagnostics: NormalizedDiagnostic[] }
  | { type: "error"; id: string; message: string }
  | { type: "ready" };
```

That's the entire protocol. Compare with the current implementation's daemon
envelope + LSP JSON-RPC + Content-Length framing.

### Speed

**First `get_diagnostics` call:** If prewarm completed (typical — takes 5-15s in
background, user usually doesn't call diagnostics in the first seconds), the
call is **warm from the start**: 100-500ms.

If prewarm is still running (user called diagnostics very quickly after
startup), the call awaits the same prewarm promise — no duplicate work, just
waits for it to finish.

**Subsequent calls:** 100-500ms per file. The type graph is cached. Only changed
files trigger incremental re-checking.

**Directory checks:** After project load, checking N files = N × (50-200ms).
Checking 50 files in a warm workspace ≈ 2.5-10s.

### ESLint

Uses ESLint's Node API (`new ESLint()` → `eslint.lintFiles()`). It's:

- **Async** — doesn't block the event loop. No worker needed.
- **In-process** — no subprocess, no IPC.
- **Cacheable** — the `ESLint` instance is reused across calls.
- **Config-aware** — respects flat config and legacy config.

ESLint is resolved from the project's `node_modules` at runtime. If not
installed, the provider reports "not available" cleanly. We don't bundle ESLint.

### Extending to other providers

The provider interface is minimal:

```ts
type DiagnosticsProvider = {
  id: string;
  isFileSupported: (filePath: string) => boolean;
  getDiagnostics: (params: ProviderParams) => Promise<NormalizedDiagnostic[]>;
  syncDocument?: (filePath: string, content?: string) => void;
  dispose?: () => void;
};
```

Adding a new provider (Biome, Stylelint, Oxlint, etc.) means implementing this
interface. All providers expose the same async interface regardless of internal
strategy:

- **Async Node API** (ESLint, Biome, Stylelint): in-process, direct.
- **CLI spawn** (Oxlint, any tool): async, non-blocking.
- **Worker thread** (TypeScript): async from main thread's perspective.

The service layer handles orchestration — providers don't need to care about
each other.

---

## File structure

```
extensions/get-diagnostics/
  index.ts                          # pi extension entry (re-export)
  package.json                      # single package
  tsconfig.json
  src/
    extension.ts                    # extension setup: tool reg, lifecycle hooks (~80 lines)
    tool.ts                         # get_diagnostics tool definition + execute (~80 lines)
    service.ts                      # orchestrates providers, aggregates results (~100 lines)
    types.ts                        # NormalizedDiagnostic, shared types (~40 lines)
    format.ts                       # text output formatting (~50 lines)
    render.ts                       # TUI renderCall / renderResult (~120 lines)
    providers/
      types.ts                      # DiagnosticsProvider interface (~30 lines)
      typescript.ts                 # main-thread wrapper: manages worker, exposes provider interface (~150 lines)
      typescript-worker.ts          # worker entry: ts.LanguageService logic (~250 lines)
      eslint.ts                     # ESLint Node API provider (~100 lines)
```

**Estimated total: ~1000 lines** (vs. current ~5000).

---

## Detailed design per file

### `src/types.ts` (~40 lines)

Shared types used across the extension.

```ts
type DiagnosticsProviderId = "typescript" | "eslint";

type NormalizedDiagnostic = {
  provider: string;
  path: string; // relative to cwd
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string;
  source?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type GetDiagnosticsResult = {
  diagnostics: NormalizedDiagnostic[];
  providerStatus: Record<
    string,
    {
      status: "ok" | "error" | "timeout" | "skipped";
      timingMs: number;
      message?: string;
    }
  >;
  truncated: boolean;
  scannedFiles: number;
  processedFiles: number;
  timingMs: number;
};
```

### `src/providers/types.ts` (~30 lines)

Provider interface contract. Every provider — regardless of whether it's
in-process, CLI, or worker-backed — exposes this same async interface.

```ts
type ProviderParams = {
  cwd: string;
  files: string[]; // absolute paths
  content?: string; // unsaved content override (single file mode)
  contentPath?: string; // which file the content belongs to
};

type DiagnosticsProvider = {
  id: string;
  isFileSupported: (filePath: string) => boolean;
  getDiagnostics: (params: ProviderParams) => Promise<NormalizedDiagnostic[]>;
  prewarm?: (cwd: string) => void; // fire-and-forget, non-blocking
  syncDocument?: (filePath: string, content?: string) => void;
  dispose?: () => void;
};
```

### `src/providers/typescript-worker.ts` (~250 lines)

The worker entry point. Runs `ts.LanguageService` on its own thread.

**Loaded via:** `new Worker('./typescript-worker.ts', { workerData, ... })`
with appropriate TypeScript loader (tsx via `execArgv`).

**Responsibilities:**

1. **Workspace resolution:** Find nearest `tsconfig.json` / `jsconfig.json`
   via `ts.findConfigFile`. Cache per workspace root.

2. **Language service creation (per workspace root):**

   - Parse tsconfig: `ts.readConfigFile` + `ts.parseJsonConfigFileContent`.
   - Implement `LanguageServiceHost`:
     - `getScriptFileNames()` — files from tsconfig.
     - `getScriptVersion(fileName)` — version from snapshot map (bumped on
       sync), or file mtime hash for disk files.
     - `getScriptSnapshot(fileName)` — content from snapshot map or disk read.
       Uses `ts.ScriptSnapshot.fromString()`.
     - `getCompilationSettings()` — parsed compiler options + `noEmit: true`.
     - `getCurrentDirectory()` — workspace root.
     - `getDefaultLibFileName()` — `ts.getDefaultLibFilePath()`.
   - `ts.createLanguageService(host)`.

3. **Message handler:**

   ```ts
   parentPort.on("message", (msg: WorkerRequest) => {
     switch (msg.type) {
       case "prewarm":
         // Create language service, call service.getProgram() to force load
         // Post { type: 'result', id, diagnostics: [] } when done
         break;
       case "getDiagnostics":
         // For each file: getSyntacticDiagnostics + getSemanticDiagnostics
         // Normalize and post back
         break;
       case "syncDocument":
         // Update snapshot map, bump version
         break;
       case "dispose":
         // service.dispose() for all cached services
         break;
     }
   });
   ```

4. **Diagnostic normalization:** Convert `ts.Diagnostic` →
   `NormalizedDiagnostic` using `ts.flattenDiagnosticMessageText`,
   `file.getLineAndCharacterOfPosition`, etc.

**Edge cases:**

- File not in any tsconfig → default compiler options (`allowJs`, `checkJs`,
  `noEmit`, `skipLibCheck`).
- tsconfig parse errors → returned as diagnostics.
- File doesn't exist on disk but `content` provided → served from snapshot.
- Worker crash → main thread detects `'exit'` event, can respawn.

### `src/providers/typescript.ts` (~150 lines)

Main-thread wrapper. Manages the worker, exposes `DiagnosticsProvider`.

```ts
const createTypescriptProvider = (): DiagnosticsProvider => {
  let worker: Worker | undefined;
  let workerReady: Promise<void>;
  const pending = new Map<string, { resolve; reject }>();

  const ensureWorker = () => {
    if (worker) return;
    worker = new Worker(new URL("./typescript-worker.ts", import.meta.url), {
      execArgv: ["--import", "tsx/esm"],
    });
    workerReady = new Promise((resolve) => {
      worker.once("message", (msg) => {
        if (msg.type === "ready") resolve();
      });
    });
    worker.on("message", (msg: WorkerResponse) => {
      if (msg.type === "result" || msg.type === "error") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.type === "result" ? p.resolve(msg.diagnostics) : p.reject(new Error(msg.message));
      }
    });
    worker.on("exit", () => {
      /* reject all pending, clear worker ref */
    });
  };

  const request = (msg: WorkerRequest): Promise<NormalizedDiagnostic[]> => {
    ensureWorker();
    return new Promise((resolve, reject) => {
      pending.set(msg.id, { resolve, reject });
      worker.postMessage(msg);
    });
  };

  return {
    id: "typescript",
    isFileSupported: (f) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(f),
    getDiagnostics: (params) =>
      request({
        type: "getDiagnostics",
        id: randomUUID(),
        ...params,
      }),
    prewarm: (cwd) => {
      ensureWorker();
      worker.postMessage({ type: "prewarm", id: randomUUID(), cwd });
      // Fire-and-forget. Result is that the language service is warm.
    },
    syncDocument: (filePath, content) => {
      if (!worker) return; // No worker yet = nothing to sync
      worker.postMessage({ type: "syncDocument", filePath, content });
    },
    dispose: () => {
      worker?.postMessage({ type: "dispose" });
      worker?.terminate();
      worker = undefined;
    },
  };
};
```

**Key detail:** `prewarm` is fire-and-forget. It sends the message and returns
immediately. The worker starts loading the project in the background. When
`getDiagnostics` is later called, the worker processes it after prewarm
completes (sequential message processing in the worker). No explicit
coordination needed — the worker's message queue handles ordering naturally.

### `src/providers/eslint.ts` (~100 lines)

Uses ESLint's Node API. Resolves ESLint from the project's `node_modules`.

```ts
const createEslintProvider = (): DiagnosticsProvider => {
  const instances = new Map<string, ESLint>();

  const getOrCreate = async (cwd: string): Promise<ESLint> => {
    const existing = instances.get(cwd);
    if (existing) return existing;

    // Dynamic import — resolves from project's node_modules
    const { ESLint } = await import("eslint");
    const instance = new ESLint({ cwd });
    instances.set(cwd, instance);
    return instance;
  };

  return {
    id: "eslint",
    isFileSupported: (f) => /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(f),
    getDiagnostics: async (params) => {
      const eslint = await getOrCreate(params.cwd);

      if (params.content && params.contentPath) {
        const results = await eslint.lintText(params.content, {
          filePath: params.contentPath,
        });
        return normalizeEslintResults(results);
      }

      const results = await eslint.lintFiles(params.files);
      return normalizeEslintResults(results);
    },
    dispose: () => instances.clear(),
  };
};
```

**Error handling:** If ESLint is not installed (`import('eslint')` throws),
catch and return a clear error. If no config found, ESLint throws — catch and
report as provider-level error, not a crash.

### `src/service.ts` (~100 lines)

Orchestrates provider execution.

1. **Provider selection:** Accept requested providers from tool input. Default to
   `['typescript']`. Filter to registered providers.

2. **File resolution:**

   - Single file → use directly.
   - Directory → glob for supported files (via `tinyglobby`), filter by
     provider support, cap at `maxFiles` (default 200).

3. **Parallel execution:** Run all selected providers concurrently with
   `Promise.allSettled`. Each provider gets a timeout via `Promise.race`.

4. **Result aggregation:** Merge diagnostics, dedupe by
   (provider, path, range, code, message), sort by file → line → severity.
   Cap at 2000 total.

### `src/tool.ts` (~80 lines)

Tool definition.

- Schema: `path` (required), `content` (optional), `providers` (optional),
  `timeoutMs` (optional), `maxFiles` (optional).
- Resolves path (file vs directory, normalize `@` prefix).
- Calls `service.getDiagnostics()`.
- Formats result via `format.ts`.
- Returns `{ content, details }`.

### `src/extension.ts` (~80 lines)

Extension entry point.

```ts
const setup = (pi: ExtensionAPI) => {
  const tsProvider = createTypescriptProvider();
  const eslintProvider = createEslintProvider();
  const service = createDiagnosticsService([tsProvider, eslintProvider]);

  registerGetDiagnosticsTool(pi, service);

  // Background prewarm on session start — non-blocking
  pi.on("session_start", (_event, ctx) => {
    tsProvider.prewarm?.(ctx.cwd);
  });

  // Document sync after file mutations
  pi.on("tool_result", (event, ctx) => {
    const payload = extractSyncPayload(event, ctx.cwd);
    if (payload) {
      service.syncDocument(payload.path, payload.content);
    }
  });

  // Cleanup
  pi.on("session_shutdown", async () => {
    service.dispose();
  });
};
```

**Prewarm flow:** `session_start` → `tsProvider.prewarm(cwd)` → sends
`postMessage` to worker → returns immediately (non-blocking). Worker starts
loading the project in the background. By the time the agent calls
`get_diagnostics`, the project is typically already loaded.

### `src/format.ts` (~50 lines)

Formats `GetDiagnosticsResult` into a text summary for the LLM.

```
src/components/Button.tsx: 2 errors, 1 warning

  [error] L12:C5 Type 'string' is not assignable to type 'number'. (2322)
  [error] L25:C10 Property 'onClick' does not exist on type 'ButtonProps'. (2339)
  [warning] L8:C1 'React' is defined but never used. (@typescript-eslint/no-unused-vars)
```

Group by file, sort by severity. Keep concise — this is what the LLM reads.

### `src/render.ts` (~120 lines)

TUI rendering for `renderCall` and `renderResult`.

- **`renderCall`:** Tool name + target path + animated spinner.
- **`renderResult`:** Status line (✓/✗) + summary count. In expanded mode
  (Ctrl+O), show per-file diagnostics with severity coloring (error=red,
  warning=yellow, info/hint=muted). Reuse the grouping/coloring approach from
  the current render file — that part is well done.

### `index.ts` (1 line)

```ts
export { default } from "./src/extension";
```

### `package.json`

```json
{
  "name": "get-diagnostics",
  "private": true,
  "type": "module",
  "scripts": {
    "format": "prettier --write .",
    "lint": "prettier --check .",
    "tsc": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "<pin-latest>",
    "@mariozechner/pi-coding-agent": "<pin-latest>",
    "@sinclair/typebox": "<pin-latest>",
    "remeda": "<pin-latest>",
    "tinyglobby": "<pin-latest>",
    "tsx": "<pin-latest>",
    "typescript": "<pin-latest>"
  },
  "devDependencies": {
    "@types/node": "<pin-latest>",
    "prettier": "<pin-latest>",
    "vitest": "<pin-latest>"
  },
  "pi": {
    "extensions": ["./src/extension.ts"]
  }
}
```

**Dependencies vs. current:**

| Kept                            | Added | Dropped                      |
| ------------------------------- | ----- | ---------------------------- |
| `@mariozechner/pi-ai`           | —     | `citty`                      |
| `@mariozechner/pi-coding-agent` | —     | `typescript-language-server` |
| `@sinclair/typebox`             | —     | `lru-cache`                  |
| `remeda`                        | —     | `p-timeout`                  |
| `tinyglobby`                    | —     | `picomatch`                  |
| `tsx` (for worker loader)       | —     | `find-up`                    |
| `typescript`                    | —     | `zod`                        |

`tsx` is kept solely as the worker thread loader (`execArgv: ['--import',
'tsx/esm']`). `typescript` is the runtime API for `ts.LanguageService`.

No `eslint` dependency — resolved from the project's `node_modules` at runtime.

---

## Lifecycle flow

```
pi starts
  └─► extension loads (instant)
      └─► creates providers (no work — lazy)
      └─► registers get_diagnostics tool

  └─► session_start fires
      └─► tsProvider.prewarm(cwd)
          └─► spawns worker thread (if not already)
          └─► posts { type: 'prewarm', cwd } to worker
          └─► returns immediately (non-blocking)
          └─► worker starts loading tsconfig + building type graph in background

  ... user types prompt, agent thinks ...

agent calls get_diagnostics("src/Button.tsx")
  └─► tool.execute()
      └─► service.getDiagnostics()
          ├─► typescript provider:
          │   └─► posts { type: 'getDiagnostics', files: [...] } to worker
          │   └─► worker processes after prewarm completes (already done typically)
          │   └─► worker returns diagnostics via postMessage
          │   └─► ~100-500ms (warm)
          ├─► eslint provider (if requested):
          │   └─► eslint.lintFiles() — async, in-process
          │   └─► ~500-2000ms
          └─► both run in parallel via Promise.allSettled
      └─► aggregates, dedupes, sorts, truncates
      └─► formats summary text
      └─► returns { content, details }

agent calls edit("src/Button.tsx", ...)
  └─► tool_result event fires
      └─► service.syncDocument("src/Button.tsx")
          └─► posts { type: 'syncDocument', filePath, content } to worker
          └─► returns immediately (fire-and-forget)

agent calls get_diagnostics("src/Button.tsx") again
  └─► worker has updated snapshot, returns fresh diagnostics
  └─► ~100-500ms
```

---

## What we keep from the current implementation

1. **Tool schema** — same params (`path`, `content`, `providers`, `timeoutMs`,
   `maxFiles`). No breaking change for the agent.
2. **`NormalizedDiagnostic` shape** — same structure.
3. **`tool_result` sync hooks** — same concept. Now a `postMessage` to the
   worker instead of daemon IPC.
4. **TUI rendering concept** — spinner + status + expandable details.
5. **Provider abstraction** — similar interface, much simpler.

## What we drop

| Dropped                                   | Replacement                             |
| ----------------------------------------- | --------------------------------------- |
| Daemon process + JSON-RPC protocol        | Worker thread + `postMessage`           |
| LSP client (1155 lines)                   | `ts.LanguageService` (direct API)       |
| `core-client.ts` (557 lines)              | ~40 lines of `postMessage` wrapper      |
| `process-manager.ts` (96 lines)           | Worker lifecycle (built-in)             |
| `workspace-resolver.ts` (150 lines)       | `ts.findConfigFile` (built-in)          |
| LRU cache                                 | `ts.LanguageService` internal caching   |
| File watchers + debouncing                | Document sync via `tool_result`         |
| JSON config file + Zod schema (257 lines) | Sensible defaults, tool param overrides |
| Separate `core/` + `wrapper/` packages    | Single package                          |

---

## Implementation order

1. **Scaffold:** `package.json`, `tsconfig.json`, `index.ts`, directory
   structure, `npm install`.
2. **Types:** `src/types.ts`, `src/providers/types.ts`.
3. **TypeScript worker:** `src/providers/typescript-worker.ts` — the critical
   path. LanguageServiceHost, diagnostic normalization, message handler.
4. **TypeScript provider:** `src/providers/typescript.ts` — worker management,
   postMessage wrapper, provider interface.
5. **Service layer:** `src/service.ts` — orchestration, file resolution,
   aggregation.
6. **Tool:** `src/tool.ts` — schema, path resolution, execution.
7. **Extension wiring:** `src/extension.ts` — prewarm, sync hooks, shutdown.
8. **Formatting:** `src/format.ts` — LLM-facing text output.
9. **Rendering:** `src/render.ts` — TUI display.
10. **ESLint provider:** `src/providers/eslint.ts`.
11. **Cleanup:** Delete old `core/`, `wrapper/`, config files, old
    `node_modules`.

Steps 1-7 produce a working extension with TypeScript diagnostics and background
prewarming. Steps 8-9 add UX polish. Step 10 adds ESLint. Step 11 removes dead
code.

---

## Risks and mitigations

| Risk                                                                | Mitigation                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Worker thread + tsx loader compatibility with jiti-loaded extension | Test early in step 3. Fallback: use compiled JS worker.                                             |
| Memory (~200-500MB for large project)                               | Same as `tsc`. Worker disposed on `session_shutdown`. Acceptable.                                   |
| TypeScript version mismatch (bundled vs project)                    | Use bundled for now. "Prefer workspace TS" is a future enhancement.                                 |
| ESLint not installed in project                                     | Provider catches, reports "not available". Not a crash.                                             |
| Worker crash                                                        | Main thread detects `'exit'` event, rejects pending requests. Next `get_diagnostics` call respawns. |
| `import('eslint')` resolves wrong version                           | Uses project's `node_modules` via Node resolution from `cwd`.                                       |

## Design decisions

1. **No config file.** Sensible defaults. Override via tool params. If persistent
   config is ever needed, use pi's settings mechanism.
2. **ESLint not enabled by default.** Default providers: `['typescript']`. Agent
   or user requests `['typescript', 'eslint']` explicitly.
3. **No "prefer workspace TypeScript" yet.** Bundled TS avoids version
   resolution complexity. Can add later if diagnostic accuracy is an issue.
4. **Prewarm is fire-and-forget.** If it fails (e.g., no tsconfig), the first
   `getDiagnostics` call handles the error normally.
5. **Worker respawn on crash.** Simple: clear worker ref, next request creates a
   new one. No persistent state to recover.
