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

At the start of each task, use targeted retrieval from memory files if they exist:
- `agent/LEARNINGS.md`
- `agent/ANTI_PATTERNS.md`
- `agent/DECISIONS.md`

Do not read these files end-to-end by default.
Use `grep` with a query set of 3-5 semantically related keywords (mix broader intent words + specific tokens like feature name, error text, package, API), then read only matching sections.
Prefer iterative retrieval: start broad, refine with adjacent terms from matches, stop when evidence is sufficient.
Only read full files when explicitly requested or during periodic memory cleanup.

### Memory Curation Rules

Capture only high-signal, reusable lessons.
Do not store one-off trivia, obvious basics, or transient noise.

Record a new entry only when at least one is true:
- The issue recurred or is likely to recur.
- The fix required non-obvious reasoning.
- The decision affects architecture, contracts, or team conventions.
- The failure mode is expensive if repeated.

Prefer two granularity levels:
- **L1 (policy-level):** durable rules and decision heuristics.
- **L2 (tactic-level):** concrete low-level fixes with precise triggers and constraints.

If an entry already exists, update/merge it instead of appending duplicates.
Keep entries concise, specific, and searchable.

When adding to `agent/LEARNINGS.md`, include:
- Context
- Signal (what failed or what worked)
- Rule (future behavior change)
- Trigger (when to apply)
- Example file/commit

## Failure Recovery Protocol

If verification fails:
1. Classify the failure (type error, test regression, formatting, logic mismatch, tooling).
2. State the likely root cause in one sentence.
3. Apply the smallest fix first.
4. Re-run impacted checks, then run the required full checks.
5. Capture a reusable non-obvious fix in `agent/LEARNINGS.md`.

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
- [ ] Reusable lesson captured in `agent/LEARNINGS.md` when applicable

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
