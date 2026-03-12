---
name: review-pre-commit
description: Review staged changes before commit in Quill. Use as a pre-commit gate when the user or another skill wants a file-by-file review of what is about to be committed.
---

# Review pre-commit

Before starting, read:

- `../quill/SKILL.md`
- `../code-review/REVIEWER.md`
- `../code-review/protocols/review-loop.md`
- `../code-review/protocols/file-ordering.md`
- `../code-review/protocols/session-file.md`
- `../code-review/protocols/session-synthesis.md`

## Workflow

1. Start from the staged file set.
2. Create a virtual first item representing the commit summary:
   - proposed commit message
   - staged file list
   - rationale for the commit
3. Review the staged files after that summary item using `staged: true`.
4. Use the review-loop protocol for the file walk.
5. During synthesis, produce an explicit go / no-go recommendation.
6. Hand the outcome back to `archivist` or the user before any commit happens.

## Semantics

- all approved → safe to proceed, unless the user still wants changes
- denied file → pause, discuss, and re-open only that file if requested
- abort → cancel the pre-commit review and treat the gate as incomplete
