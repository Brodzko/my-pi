# GitLab comment synthesis protocol

Use this protocol when a review session needs to become GitLab MR comments.

## Core rule

Raw annotations and TUI discussion are **working notes**, not ready-to-post MR
comments.

Always synthesize a fresh proposal before posting anything.

## Eligibility filter

A point qualifies for GitLab synthesis only if the reviewer:

- created it (`source: "user"`), or
- replied to it in the TUI / Quill discussion, or
- explicitly adopted it in the TUI (for example: "yes, post this")

Approval of a file does **not** adopt every agent annotation on that file.
Agent-only notes that the reviewer never adopted must be dropped.

## Rewrite rules

When synthesizing a comment:

- never copy raw annotation text verbatim unless the user explicitly approved
  that exact phrasing
- combine related concerns when that improves clarity
- rewrite in the reviewer's voice
- keep comments concise and human
- prefer one direct question or observation over a mini design doc
- drop internal review noise and preference markers

## Process

1. Filter the session down to endorsed reviewer-owned points.
2. Group related points where appropriate.
3. Produce a numbered comment proposal in the TUI.
4. Wait for explicit approval or edits.
5. Post only the exact approved text.
   - line comments → `gl mr note create-line`
   - general comments → `gl mr note create`
6. If there are no qualifying comments, offer to approve the MR instead.

## Example format

```text
GitLab comments to post on !42:

1. src/parser.ts:25
   > Would it make sense to extract this validation into the shared helper?

2. src/auth.ts:112
   > Do we need to guard refresh so two concurrent requests don't both re-run it?
```
