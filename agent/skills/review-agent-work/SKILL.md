---
name: review-agent-work
description: Review the agent's local code changes in Quill. Use when the user asks to inspect or review the edits made in the current working tree.
---

# Review agent work

Before starting, read:

- `../quill/SKILL.md`
- `../code-review/REVIEWER.md`
- `../code-review/protocols/review-loop.md`
- `../code-review/protocols/file-ordering.md`
- `../code-review/protocols/session-file.md`
- `../code-review/protocols/session-synthesis.md`

## Workflow

1. Identify changed files from unstaged and/or staged diff state.
2. Build an ordered file list using the file-ordering protocol.
3. Prepare annotations only for corrections worth the reviewer's attention.
4. Use the review-loop protocol with `unstaged: true` or `staged: true` as
   appropriate, but choose the mode per file:
   - existing changed files should open in diff mode against the working-tree
     baseline (`unstaged: true` or `staged: true`)
   - entirely new files may open in raw mode because there is no old side to
     diff against
   - if the first open used raw mode by mistake and a baseline exists, re-open
     the file in diff mode on request

## Notes

- Do not open Quill spontaneously; use this only when explicitly triggered.
- Prefer unstaged review for the agent's fresh local changes unless the user
  asked to review the staged set.
