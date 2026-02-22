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

For every non-trivial task:
1. Restate the goal and constraints in 1-3 bullets.
2. Propose a short plan (2-5 steps) before making edits.
3. Execute incrementally in small, reviewable changes.
4. Verify with relevant checks.
5. Reflect briefly on uncertainty, failed attempts, and what should be reused.

## Continuous Learning

At the start of each task, read these files if they exist and apply relevant rules:
- `agent/LEARNINGS.md`
- `agent/ANTI_PATTERNS.md`
- `agent/DECISIONS.md`

When a task reveals a reusable lesson, append it to `agent/LEARNINGS.md` using:
- Context
- Signal (what failed or what worked)
- Rule (future behavior change)
- Trigger (when to apply)
- Example file/commit

Keep lessons short and specific. Prefer one durable lesson over many vague notes.

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
