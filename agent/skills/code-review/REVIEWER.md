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

### `pref-gitlab-user-endorsed-only` — GitLab comments only from user-endorsed annotations
- **Category:** other
- **Scope:** global
- **Confidence:** high
- **Discovered:** 2026-03-11
- **Last seen:** 2026-03-11

When synthesizing GitLab MR comments, only consider annotations the reviewer
created, replied to, or explicitly approved. Agent-only annotations that were
never interacted with are working notes and must not become GitLab comments.
Comments must always be freshly synthesized — never copied verbatim from
annotations or TUI discussion.

**Example:**
```
❌ Copying annotation text: "[matches pref-X] Consider using R.map here" → GitLab
✅ Synthesizing from user reply: reviewer flagged duplication + discussed scope in TUI → clean comment about extracting shared helper
```

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
