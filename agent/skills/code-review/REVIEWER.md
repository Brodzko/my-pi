# Reviewer Preferences

Learned review preferences, discovered through code review sessions. Each
preference is structured for potential promotion to global `AGENTS.md` or
project-level agent instructions.

## How to use this file

- **Before a review session:** Load this file and use preferences to
  pre-generate anticipated annotations on code that matches known patterns.
- **After a review session:** Reflect on annotations the user created, patterns
  in their approvals/denials, and discussion themes. Identify new preferences
  not yet captured here. Ask the user whether to persist them.
- **Promoting preferences:** Each preference is tagged with a scope suggestion.
  When a preference is stable and broadly applicable, suggest lifting it to the
  appropriate `AGENTS.md` (global or project-level).

## Preference format

Each preference has:

- **ID:** Stable short identifier for grep/reference (e.g. `pref-naming-handlers`)
- **Category:** One of: `naming`, `structure`, `patterns`, `style`, `testing`,
  `error-handling`, `performance`, `documentation`, `dependencies`, `types`,
  `react`, `git`, `other`
- **Scope suggestion:** `global` (all projects), `frontend` (frontend projects),
  `project:<name>` (specific repo), `personal` (this reviewer only)
- **Confidence:** `high` (seen 3+ times), `medium` (seen twice), `low` (seen once)
- **Description:** What the reviewer prefers and why
- **Example:** Concrete code pattern or review comment illustrating the preference
- **Discovered:** Date first observed
- **Last seen:** Date last reinforced

---

## Preferences

### `pref-corrections-only` — Annotations must flag corrections only

- **Category:** style
- **Scope:** global
- **Confidence:** high
- **Discovered:** 2026-03-11
- **Last seen:** 2026-03-11

Annotations should only flag things the reviewer would want to correct — bugs,
design concerns, style violations, missing edge cases. No explanatory
annotations ("this is what changed"), no praise ("nice pattern here"), no
informational commentary. Zero annotations on a clean file is fine. High
signal-to-noise ratio is the priority.

**Example:**

```
❌ "This function handles the retry logic with exponential backoff" (explanation)
❌ "Good use of discriminated unions here" (praise)
✅ "Race condition: concurrent calls both hit refresh before the first resolves" (correction)
```

### `pref-gitlab-user-endorsed-only` — GitLab comments only from reviewer-owned or explicitly adopted points

- **Category:** other
- **Scope:** global
- **Confidence:** high
- **Discovered:** 2026-03-11
- **Last seen:** 2026-03-11

When synthesizing GitLab MR comments, only consider points the reviewer
created, replied to, or explicitly adopted in the TUI. File approval does not
count as adopting every agent annotation on that file. Agent-only notes that
were never explicitly adopted must not become GitLab comments.

**Example:**

```
❌ File approved in Quill, so post the agent's bug note to GitLab
✅ Reviewer asks their own question in Quill, so synthesize only that question for GitLab
```

### `pref-gitlab-comments-terse-human` — GitLab comments should be short and sound human

- **Category:** style
- **Scope:** personal
- **Confidence:** high
- **Discovered:** 2026-03-11
- **Last seen:** 2026-03-11

Keep GitLab comments concise and natural. Prefer one short observation or
question over an explained paragraph. Avoid wording that makes the reviewer
sound like an AI, spec, or design doc.

**Example:**

```
❌ "The `Tab ↹` badge highlight seems keyed only by `id`, but different option types can share the same numeric id..."
✅ "Do we key the highlight by both type and id?"
```

### `pref-ternary-jsx` — Ternary over `&&` in JSX

- **Category:** style
- **Scope:** frontend
- **Confidence:** medium
- **Discovered:** 2026-03-12
- **Last seen:** 2026-03-12

Prefer `{condition ? <Foo /> : null}` over `{condition && <Foo />}` in JSX.
Instructed on two separate files in a single review session.

**Example:**

```tsx
❌ {hasOverflow && <OverflowMenu />}
✅ {hasOverflow ? <OverflowMenu /> : null}
```

### `pref-compact-comments` — Comments only when intent is non-obvious

- **Category:** documentation
- **Scope:** global
- **Confidence:** medium
- **Discovered:** 2026-03-12
- **Last seen:** 2026-03-12

Remove or compact explanatory comments. They are only necessary if intent cannot
be inferred from naming. Prefer clarity through naming/structure over inline
commentary. When a comment is needed, keep it short — one line, not a paragraph.

**Example:**

```ts
❌ // Self-width fallback: observe root element width when no budget is provided.
❌ // Prune stale refs and reset counts when the item list changes.
✅ // State (not derived from ref) so first mount triggers re-render once refs populate.
   (non-obvious design decision → comment justified)
```

### `pref-types-near-component` — Types above component, below utilities

- **Category:** structure
- **Scope:** frontend
- **Confidence:** medium
- **Discovered:** 2026-03-12
- **Last seen:** 2026-03-12

Place type definitions (props, options, result types) right above the component
or hook definition, not at the top of the file when utility functions sit
between. Reader should see the type contract immediately before the
implementation it describes.

**Example:**

```ts
// utilities first
const computeFittingCount = (...) => { ... };

// then types
type UseOverflowContainerOptions = { ... };

// then implementation
const useOverflowContainer = (options: UseOverflowContainerOptions) => { ... };
```

### `pref-diff-mode-review` — Use diff mode for modified files in review

- **Category:** other
- **Scope:** global
- **Confidence:** low
- **Discovered:** 2026-03-12
- **Last seen:** 2026-03-12

When reviewing modified files (not new files), open them in Quill's diff mode
against the merge base. This surfaces what actually changed rather than
requiring the reviewer to mentally diff the entire file.

### `pref-no-for-of` — No `for...of` loops

- **Category:** style
- **Scope:** project:elis-frontend
- **Confidence:** low
- **Discovered:** 2026-03-12
- **Last seen:** 2026-03-12

The project linter blocks `for...of` loops. Use `forEach` as the minimum
imperative alternative when a declarative approach (Remeda, `.map`, etc.) isn't
a good fit.

---

## Promoted

_Preferences that graduated to an `AGENTS.md` file. Kept as a one-line record._

<!-- Format: `pref-<id>` → <target file> § <section> (<date>) -->

---

## Retired

_Preferences that went stale (low confidence, not seen in 90+ days). Can be
revived if they resurface._

---

<!--
### Template for new preferences:

### `pref-<id>` — <short title>
- **Category:** <category>
- **Scope:** <scope suggestion>
- **Confidence:** <low | medium | high>
- **Discovered:** <YYYY-MM-DD>
- **Last seen:** <YYYY-MM-DD>

<Description of the preference — what the reviewer wants and why.>

**Example:**
```
<concrete code snippet, annotation, or review comment>
```
-->
