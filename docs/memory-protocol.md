# Memory Protocol

> Agent-agnostic protocol for persistent, per-project memory. This file is the
> source of truth — the inline version in `agent/AGENTS.md` should stay in sync.

## Overview

The memory system is file-based and grep-driven. Any agent that can read/write
files and run grep can use it without modification.

## Directory layout

```
<project-root>/
  .brodzko/
    memory/
      _template.md           # frontmatter + section template
      <descriptive-name>.md  # one memory per file
```

- **One memory per file** — no giant append-only files.
- File names must be descriptive and grep-friendly, e.g.
  `vite-ts-path-alias-resolution.md`.
- Never create `.brodzko/memory/` inside subdirectories (e.g.
  `packages/foo/.brodzko/memory`). Always use the project root.

## Initialization

When project memory is missing:

1. Create `.brodzko/memory/`.
2. Ensure `.brodzko/` is gitignored (prefer `.git/info/exclude` for local-only
   ignore; use `.gitignore` only if requested).
3. Create `.brodzko/memory/_template.md` using the format below.

## File format (required)

Each file starts with YAML frontmatter and includes four mandatory sections:

```md
---
keywords: ['vite', 'tsconfig', 'path-alias']
summary: 'Fix TS path aliases by aligning tsconfig paths and bundler resolver.'
tags: ['tooling', 'typescript', 'build']
related: ['tsconfig-paths', 'vite.config.ts']
---

## Trigger

- When imports resolve in editor but fail at runtime/build.

## Learning

- Keep alias source-of-truth in one place and derive secondary config.

## Reflection

- What we did: Aligned alias config between TypeScript and bundler.
- Why we did it: Runtime/build resolution diverged from editor behavior.
- Where we failed/succeeded: Failed with split sources of truth; succeeded after
  consolidating alias ownership.
- How we arrived here: Reproduced failure, compared resolver configs, then
  validated with build/typecheck.

## References

- apps/web/vite.config.ts
- tsconfig.base.json
```

## Retrieval protocol

At the start of each task, do targeted retrieval:

1. **Project memory** (primary): `<project-root>/.brodzko/memory/**/*.md`
2. **Global memory** (fallback): agent-specific location (see below)

Do not read memory end-to-end by default. Use `grep` with 3-5 semantically
related keywords (mix intent words + concrete tokens like feature name, error
text, package, API), then read only matching files/sections. Prefer iterative
retrieval: start broad, refine with adjacent terms from matches, stop when
evidence is sufficient.

### Global memory locations by agent

| Agent      | Global memory path                                               |
| ---------- | ---------------------------------------------------------------- |
| pi         | `~/.pi/agent/LEARNINGS.md`, `ANTI_PATTERNS.md`, `DECISIONS.md`  |
| Claude Code| `~/.claude/CLAUDE.md` (or dedicated memory sections within it)   |

## Curation rules

Capture only high-signal, reusable lessons. Do not store one-off trivia, obvious
basics, or transient noise.

Record or update a project memory when at least one is true:

- The issue recurred or is likely to recur.
- The fix required non-obvious reasoning.
- The decision affects architecture, contracts, or team conventions.
- The failure mode is expensive if repeated.

### Deduplication

Before creating a new file, grep `.brodzko/memory/` using candidate
keywords/tags/error tokens. If overlap exists, update the existing file instead
of creating a near-duplicate.

## Session reflection (required)

At the end of every meaningful task/session, run a short reflective pass and
update project memory proactively:

1. What triggered the work?
2. What changed in behavior/process/tooling that should be repeated?
3. Is this a new memory or an update to an existing one?
4. Which references make the memory verifiable?

Store as either:

- **Reflective memory**: decision heuristics, tradeoff rationale, process
  lessons.
- **Procedural memory**: step-by-step repeatable workflow/checklist.

Both use the same frontmatter + four-section structure.
