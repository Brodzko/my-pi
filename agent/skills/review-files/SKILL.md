---
name: review-files
description: Review specific files, a directory, or a feature area in Quill. Use when the user asks for a file-by-file review outside the merge request workflow.
---

# Review files

Before starting, read:

- `../quill/SKILL.md`
- `../code-review/REVIEWER.md`
- `../code-review/protocols/review-loop.md`
- `../code-review/protocols/file-ordering.md`
- `../code-review/protocols/session-file.md`
- `../code-review/protocols/session-synthesis.md`

## Workflow

1. Identify the target files.
2. If the target is a directory or feature area, narrow to the relevant source
   files.
3. Build the ordered file list using the file-ordering protocol.
4. Prepare correction-only annotations.
5. Run the review-loop protocol in raw mode unless the user explicitly asked for
   a diff against a ref.

## Single-file inspection

If the user only wants to inspect or discuss one file, you may skip the full
multi-file review loop:

1. Open that file in Quill.
2. Optionally preload relevant annotations.
3. Process the output directly in the TUI.
4. Create a session file only if the interaction expands into multi-file review.
