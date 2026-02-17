# Global Agent Instructions

## About Me

Senior frontend engineer. TypeScript and React. I care deeply about clean,
maintainable codebases that other engineers can work in productively.

Don't over-explain basics — I know JS/TS/React well. Focus on the "why" behind
non-obvious decisions.

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

## Communication

- Be direct — skip preamble and filler
- When there are multiple valid approaches, briefly list tradeoffs and recommend
  one
- If something looks wrong in existing code, mention it — but ask before fixing
  unrelated issues
- When uncertain about intent, ask rather than assume
- Outside my core stack (TS/React/frontend), give more context — but always lead with *why* something works that way before explaining *how*. I want to build mental models, not just follow instructions
