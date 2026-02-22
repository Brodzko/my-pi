# .pi Repo Instructions

Before considering any code task done, run `npm run format` and `npm run tsc` in the relevant package if it is an npm package, and fix all errors. Every extension/skill that includes code should have these scripts.

When installing `npm` packages, always pin at exact version (no `^` or `~`), prefer latest at the point of installation.

When importing anything from `remeda`, use `import * as R from 'remeda'` to named imports.

## Developing `pi` extensions and skills

### Portability-first architecture (default)

- Treat portability as a hard requirement. Avoid designs that depend on `pi` internals unless absolutely necessary.
- Default architecture: **portable core executable + thin `pi` wrapper extension + skill instructions**.
- Keep business logic in the executable. `pi` code should be adapter/wiring only.
- Assume future migration to another agent (e.g. Claude Code) and design so the core is reusable unchanged.

### Responsibilities by layer

- **Core executable (portable):**
  - owns domain/business logic
  - accepts structured JSON input and returns structured JSON output
  - has stable, versioned contracts (success + error envelopes)
  - must not import `pi` SDK/runtime APIs
- **`pi` wrapper extension (thin adapter):**
  - registers tool(s) only when enabled
  - maps tool args <-> executable JSON contract
  - runs executable and maps response/errors back to tool result
  - may add optional `pi` UX only (render/status/telemetry)
- **Skill instructions:**
  - describe when to use the tool and expected behavior
  - provide policy/decision guidance, not business logic
  - act as opt-in control surface for exposing the tool

### Execution model

- Prefer invoking the core via explicit local command path (no hidden global dependencies).
- Typical flow: tool call -> wrapper validates/maps args -> executes core -> parses JSON -> returns tool result.
- If wrappers need agent-specific behavior, isolate it behind adapter boundaries.

### Local-only distribution (for now)

- Default to local-only distribution:
  - workspace/local packages and repo-local binaries are preferred
  - no publishing to external registries unless explicitly requested
- Keep execution deterministic:
  - pin versions exactly
  - use explicit command paths
  - avoid implicit global installs

### Opt-in behavior (mandatory)

- Tools/skills must be opt-in:
  - only register/expose tools when the corresponding skill is enabled
  - when disabled, do not expose the tool and do not install extra dependencies
- If installation is needed, prefer explicit local setup paths; avoid side effects when feature is disabled.

### Definition of done for new `pi` extensions/skills

- Portable core executable exists (or a clear justification why not).
- Wrapper is thin and contains no domain logic.
- Stable JSON I/O contract is documented.
- Tool exposure is gated by skill enablement.
- Local-only installation/execution path is documented.
- Migration path to at least one non-`pi` agent (e.g. Claude Code) is documented before work is considered complete.
