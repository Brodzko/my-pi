# get-diagnostics

A pi extension that gives the agent fast, editor-accurate diagnostics (type
errors, lint violations, etc.) via a `get_diagnostics` tool. It uses the same
language servers that VS Code uses, so results match what you see in your editor.

## How it works

```
                     ┌─────────────────────┐
  agent calls        │   get_diagnostics   │
  get_diagnostics ──▶│       tool          │
                     └────────┬────────────┘
                              │
                     ┌────────▼────────────┐
                     │  DiagnosticsService  │   orchestrates providers,
                     │  (service.ts)        │   resolves files, dedup/sort
                     └────────┬────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ TypeScript  │  │   ESLint   │  │  (future)  │
     │  Provider   │  │  Provider  │  │  Provider   │
     └────────────┘  └────────────┘  └────────────┘
```

### Extension lifecycle (`extension.ts`)

1. **Setup** — creates providers, wires them into the service, registers the
   tool.
2. **`session_start`** — triggers background prewarm (tsserver loads the
   project).
3. **`tool_result`** — after every file edit/write, syncs the changed document
   to providers so the next diagnostics check is incremental.
4. **`session_shutdown`** — disposes providers and cleans up.

### Service layer (`service.ts`)

Resolves the target path (single file or directory glob), fans out to providers
in parallel with a per-provider timeout (`p-timeout`), then deduplicates, sorts,
and caps results at 2000 diagnostics.

### Providers (`providers/`)

Each provider implements the `DiagnosticsProvider` interface:

```ts
type DiagnosticsProvider = {
  id: string;
  supportedExtensions: readonly string[];
  isFileSupported: (filePath: string) => boolean;
  getDiagnostics: (params: ProviderParams) => Promise<NormalizedDiagnostic[]>;
  prewarm?: (cwd: string) => void;
  syncDocument?: (filePath: string, content?: string) => void;
  dispose?: () => void;
  onPrewarmDone?: (info: PrewarmDoneInfo) => void;
};
```

**TypeScript provider** — spawns `tsserver` (the same server VS Code uses) as a
child process and communicates over its Content-Length framed JSON protocol.
Keeps the process alive between calls for incremental checking. Shuts down after
2 minutes of inactivity.

**ESLint provider** — dynamically `require()`s the project's local ESLint
installation and calls `lintFiles`/`lintText`.

### Rendering (`render.ts`)

The TUI renders results grouped by provider (TypeScript first, then ESLint),
color-coded by severity. When collapsed, a short preview of the most important
diagnostics is shown. When expanded, all diagnostics are listed grouped by file.

### Formatting (`format.ts`)

Plain text formatting of results for the LLM response — no ANSI codes, just
structured text the model can parse.

## Adding a new provider

To add diagnostics for a new language (JSON Schema, YAML, CSS, etc.):

### 1. Create the provider file

```
src/providers/my-lang.ts
```

Implement `DiagnosticsProvider`:

```ts
import * as path from 'node:path';
import type { NormalizedDiagnostic } from '../types.js';
import type { DiagnosticsProvider, ProviderParams } from './types.js';

export const createMyLangProvider = (): DiagnosticsProvider => {
  const supportedExtensions = ['json', 'yaml', 'yml'] as const;
  const extPattern = new RegExp(`\\.(${supportedExtensions.join('|')})$`);

  return {
    id: 'my-lang',
    supportedExtensions,
    isFileSupported: filePath => extPattern.test(filePath),

    async getDiagnostics(
      params: ProviderParams
    ): Promise<NormalizedDiagnostic[]> {
      // 1. Resolve the language server / linter from the project
      //    (use createRequire(cwd) to find the project's installation)
      //
      // 2. Run it against params.files
      //    - If params.content is set and params.contentPath matches a file,
      //      use the provided content instead of reading from disk
      //
      // 3. Normalize results to NormalizedDiagnostic[]
      //    - path: relative to params.cwd
      //    - severity: "error" | "warning" | "info" | "hint"
      //    - range: 0-indexed line/character
      //    - provider: must match this provider's id
    },

    // Optional: background initialization
    prewarm(cwd: string): void {
      // Start the language server, load schemas, etc.
    },

    // Optional: keep the server in sync with file changes
    syncDocument(filePath: string, content?: string): void {
      // Notify the language server that a file changed
    },

    dispose(): void {
      // Shut down the language server
    },
  };
};
```

### 2. Register in `extension.ts`

```ts
import { createMyLangProvider } from './providers/my-lang.js';

// In setup():
const myLangProvider = createMyLangProvider();
const service = createDiagnosticsService([
  tsProvider,
  eslintProvider,
  myLangProvider,
]);
```

### 3. Update render order (optional)

In `render.ts`, add the provider to `PROVIDER_ORDER` to control where it appears
in output:

```ts
const PROVIDER_ORDER: Record<string, number> = {
  typescript: 0,
  eslint: 1,
  'my-lang': 2,
};
```

### Key design decisions for providers

- **Resolve from the project, not globally.** Use `createRequire(cwd)` to find
  the project's installation. Fall back to a bundled version only as a last
  resort.
- **Keep the process alive.** Language servers are expensive to start. Reuse
  across calls and shut down on idle timeout.
- **Return `NormalizedDiagnostic[]`, not errors.** If the provider can't run
  (not installed, config missing), return an info-level diagnostic explaining
  why. Let the service handle timeouts.
- **Support `content` for unsaved files.** When `params.content` is set,
  the agent is checking a file that hasn't been written to disk yet. Use
  the provided content instead of reading from disk.
- **Prewarm is fire-and-forget.** Don't block. Start the server in the
  background and let the first `getDiagnostics` call wait for readiness.

## File structure

```
src/
├── extension.ts          # Pi extension entry — lifecycle, event wiring       ← pi-coupled
├── tool.ts               # Tool registration (params, execute, render)        ← pi-coupled
├── render.ts             # TUI rendering (collapsed preview + expanded view)  ← pi-coupled
├── service.ts            # Orchestration — file resolution, parallel providers, dedup
├── shared.ts             # Shared utilities (severity counting, formatting)
├── format.ts             # Plain text formatting for LLM responses
├── types.ts              # Shared diagnostic types
├── config.ts             # Config file loading (zod schema)
├── logger.ts             # Debug logger (project-scoped .brodzko/logs/)
└── providers/
    ├── types.ts           # DiagnosticsProvider interface
    ├── typescript.ts      # tsserver-based TypeScript diagnostics
    └── eslint.ts          # ESLint diagnostics
```

## Portability — migrating away from pi

The extension was designed so that the diagnostic engine (providers, service,
formatting) has zero pi dependencies. Only the agent-wiring layer couples to pi.

### What's portable (9 files, ~85% of logic)

These files import nothing from `@mariozechner/pi-*` and work in any Node.js
environment:

| File                      | Responsibility                                               |
| ------------------------- | ------------------------------------------------------------ |
| `providers/types.ts`      | `DiagnosticsProvider` interface                              |
| `providers/typescript.ts` | tsserver child process, protocol, diagnostics                |
| `providers/eslint.ts`     | Dynamic ESLint resolution + linting                          |
| `service.ts`              | File resolution, parallel provider execution, dedup/sort/cap |
| `format.ts`               | Plain text formatting (what the LLM reads)                   |
| `shared.ts`               | `countBySeverity`, `formatCounts`                            |
| `types.ts`                | `NormalizedDiagnostic`, `GetDiagnosticsResult`, etc.         |
| `config.ts`               | Config file loading (zod)                                    |
| `logger.ts`               | Debug logging to `.brodzko/logs/`                            |

### What's pi-coupled (3 files)

| File           | Pi dependency                                                                                                                                | What it does                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `extension.ts` | `ExtensionAPI`, `ExtensionContext`, event types (`session_start`, `tool_result`, `session_shutdown`), `isEditToolResult`/`isWriteToolResult` | Lifecycle wiring: prewarm on session start, document sync on file edits, dispose on shutdown |
| `tool.ts`      | `ExtensionAPI.registerTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `ExtensionContext`, `StringEnum`                                  | Tool registration: parameter schema, execute handler, render hooks                           |
| `render.ts`    | `Theme`, `ThemeColor` (from pi-coding-agent), `Component`, `Text`, `truncateToWidth` (from pi-tui)                                           | TUI rendering: collapsed preview, expanded view, severity colors                             |

### Migration effort by target

**Claude Code (MCP tool server):**
Replace the 3 pi-coupled files with an MCP server that exposes `get_diagnostics`
as a tool. The service, providers, and format layers are reused as-is.
Estimated: ~1 day. `render.ts` is dropped (MCP has no TUI). `tool.ts` becomes
an MCP tool handler. `extension.ts` becomes server lifecycle (start/stop
providers).

**Any agent with tool/function calling (e.g. OpenAI, custom):**
Same approach — write a thin adapter that registers the tool and maps
args/results. The portable core doesn't change.

**Standalone CLI:**
Wrap `service.ts` in a CLI entry point (e.g. with `citty`). Accept path,
providers, timeout as flags. Print `format.ts` output to stdout. No agent
integration needed — useful for CI or editor plugins.

### Key portability decisions

- **Providers own their extensions.** Each provider declares
  `supportedExtensions` — the service derives glob patterns from them. No
  central hardcoded list to maintain.
- **Format is plain text, not TUI.** `format.ts` produces agent-readable text
  with no ANSI codes. This is the primary output contract — TUI rendering is
  optional chrome.
- **Service is a pure function orchestrator.** `createDiagnosticsService` takes
  providers as constructor args and returns a plain object with
  `getDiagnostics`, `prewarm`, `syncDocument`, `dispose`. No framework coupling.
- **Config and logging are self-contained.** They read from files and write to
  files — no pi APIs involved.
