# Global Agent Instructions

## About Me

Senior frontend engineer. TypeScript and React. I care deeply about clean,
maintainable codebases that other engineers can work in productively.

Don't over-explain basics — I know JS/TS/React well. Focus on the "why" behind
non-obvious decisions.

## Global instructions

Always work in the current pwd where you were invoked and where you are running.
Do not go outside unless you're explicitly asked to or you ask for permission. You do not need to `cd` into a directory you're already in.

## Execution Loop (mandatory)

For major or high-risk tasks (or when review/approval is needed before implementation):
1. Restate the goal and constraints in 1-3 bullets.
2. Propose a short plan (2-5 steps) before making edits.
3. Ask for review/approval if requested or implied by the task.
4. Execute incrementally in small, reviewable changes.
5. Verify with relevant checks.
6. Reflect briefly on uncertainty, failed attempts, and what should be reused.

For minor, low-risk tasks, proceed directly without mandatory upfront plan approval.

## Continuous Learning

Primary memory is **per-project** and must be proactively maintained in the current cwd:
- Directory: `.brodzko/memory/`
- One memory per file (no giant append-only file)
- File names must be descriptive and grep-friendly, e.g. `vite-ts-path-alias-resolution.md`

At the start of each task, do targeted retrieval from:
1. Project memory: `.brodzko/memory/**/*.md` (primary)
2. Global memory (fallback):
   - `~/.pi/agent/LEARNINGS.md`
   - `~/.pi/agent/ANTI_PATTERNS.md`
   - `~/.pi/agent/DECISIONS.md`

Do not read memory end-to-end by default.
Use `grep` with 3-5 semantically related keywords (mix intent words + concrete tokens like feature name, error text, package, API), then read only matching files/sections.
Prefer iterative retrieval: start broad, refine with adjacent terms from matches, stop when evidence is sufficient.

When project memory is missing, initialize it:
- Create `.brodzko/memory/`
- Ensure `.brodzko/` is gitignored (prefer `.git/info/exclude` for local-only ignore; use `.gitignore` only if requested)
- Create `.brodzko/memory/_template.md` if missing, using the required format below

### Project Memory File Format (required)

Each `.brodzko/memory/*.md` file must start with YAML frontmatter.
Each memory must include `## Trigger`, `## Learning`, `## Reflection`, and `## References` sections.

```md
---
keywords: ["vite", "tsconfig", "path-alias"]
summary: "Fix TS path aliases by aligning tsconfig paths and bundler resolver."
tags: ["tooling", "typescript", "build"]
related: ["tsconfig-paths", "vite.config.ts"]
---

## Trigger
- When imports resolve in editor but fail at runtime/build.

## Learning
- Keep alias source-of-truth in one place and derive secondary config.

## Reflection
- What we did: Aligned alias config between TypeScript and bundler.
- Why we did it: Runtime/build resolution diverged from editor behavior.
- Where we failed/succeeded: Failed with split sources of truth; succeeded after consolidating alias ownership.
- How we arrived here: Reproduced failure, compared resolver configs, then validated with build/typecheck.

## References
- apps/web/vite.config.ts
- tsconfig.base.json
```

### Memory Curation Rules

Capture only high-signal, reusable lessons.
Do not store one-off trivia, obvious basics, or transient noise.

Record or update a project memory when at least one is true:
- The issue recurred or is likely to recur.
- The fix required non-obvious reasoning.
- The decision affects architecture, contracts, or team conventions.
- The failure mode is expensive if repeated.

Before creating a new memory file, run a duplicate check:
- Grep `.brodzko/memory/` using candidate keywords/tags/error tokens.
- If overlap exists, update the existing file instead of creating a near-duplicate.

If an entry already exists, update/merge it instead of duplicating.
Keep entries concise, specific, and searchable.

### Session Reflection & Procedural Memory (required)

At the end of every meaningful task/session, run a short reflective pass and update project memory proactively (without waiting for explicit user request):
1. What triggered the work? (bug, request, failure mode, decision point)
2. What changed in behavior/process/tooling that should be repeated?
3. Is this a new memory or an update to an existing one?
4. Which references make the memory verifiable (file paths, commands, PR/commit)?

Store this as either:
- **Reflective memory**: decision heuristics, tradeoff rationale, process lessons.
- **Procedural memory**: step-by-step repeatable workflow/checklist for future tasks.

Use the same required frontmatter and `Trigger/Learning/Reflection/References` structure.
`Reflection` is mandatory and should capture: what we did, why we did it, where we failed/succeeded, and how we arrived at the result.
When procedural, encode the learning as concise ordered steps in `Learning`.

## Failure Recovery Protocol

If verification fails:
1. Classify the failure (type error, test regression, formatting, logic mismatch, tooling).
2. State the likely root cause in one sentence.
3. Apply the smallest fix first.
4. Re-run impacted checks, then run the required full checks.
5. Capture a reusable non-obvious fix in project memory (`.brodzko/memory/`) and optionally mirror a distilled policy to `~/.pi/agent/LEARNINGS.md` if broadly reusable.

## Code Style

- Prefer `const` and arrow functions for components and utilities
- Prefer `type` over `interface` always
- Favor named exports over default exports
- Avoid `any` — use `unknown` and narrow if you _must_, but good typing is
  preferred. No disabling comments
- Avoid `enum` — prefer `as const` objects or union types
- Keep files focused — one component/hook/utility per file

## React

- Functional components only
- Prefer composition over prop drilling — use context, compound components, or
  render props where appropriate
- Extract custom hooks when logic is reused or a component gets too complex
- Keep components pure — side effects belong in hooks or event handlers
- Prefer controlled components
- Name event handler props `onX` and handler implementations `handleX`
- Always name the type of the props of component as `ComponentNameProps`

## Patterns I Value

- Small, focused functions with clear inputs and outputs
- Immutable data patterns — no mutation of props, state, or shared objects
- Early returns over nested conditionals
- Colocation — keep related things close together
- Delete dead code instead of commenting it out
- Prefer using utilities from Remeda when possible

## Patterns to Avoid

- Premature abstraction — duplication is cheaper than the wrong abstraction
- God components or utility files that grow unbounded
- Barrel files (`index.ts` re-exports) unless explicitly requested
- Wrapping native elements without forwarding refs and props
- `useEffect` for derived state — compute it during render instead
- Syncing state between components — lift it up or use context

## When Refactoring

- Prefer incremental, reviewable changes over big rewrites
- Don't refactor code unrelated to the current task unless asked
- When suggesting improvements, explain the tradeoff (readability, perf,
  maintainability)
- Keep backwards compatibility unless explicitly told to break it

## Git

- Conventional commit messages: `type(scope): description`
- Keep commits atomic and focused
- Separate refactors from feature changes in different commits

## Definition of Done (every task)

- [ ] Goal implemented as requested
- [ ] Scope respected (no unrelated refactors)
- [ ] `npm run format` and `npm run tsc` run in relevant package(s)
- [ ] Relevant tests run, or explicitly called out as not run
- [ ] Risks, assumptions, and follow-ups stated clearly
- [ ] Reusable lesson captured in `.brodzko/memory/` (project) when applicable; promote to `~/.pi/agent/LEARNINGS.md` only if cross-project

## Communication

- Be direct — skip preamble and filler
- When there are multiple valid approaches, briefly list tradeoffs and recommend
  one
- If something looks wrong in existing code, mention it — but ask before fixing
  unrelated issues
- When uncertain about intent, ask rather than assume
- Outside my core stack (TS/React/frontend), give more context — but always lead
  with _why_ something works that way before explaining _how_. I want to build
  mental models, not just follow instructions
