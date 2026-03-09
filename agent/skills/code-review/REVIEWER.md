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

_No preferences recorded yet. They will be added after review sessions._

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
