# Review loop protocol

Use this protocol for **multi-file** Quill review workflows.

Before starting:

- read `../../quill/SKILL.md`
- read `../REVIEWER.md`
- read `./session-file.md`

## Loop

1. Initialize the session file.
2. Compute the ordered file list.
3. Present an overview: file list, ordering rationale, and high-level review
   context.
4. Ask the user to start the review using `choose_options`.
   - if **no**, stop and proceed to synthesis with nothing reviewed
   - if **yes**, begin the file walk
5. For each file:
   - open it in Quill with the correct mode (`raw`, `diffRef`, `staged`, or
     `unstaged`)
   - when a meaningful baseline exists, prefer a diff mode over raw mode so the
     reviewer sees the change, not just the resulting file
   - use raw mode for entirely new files or when there truly is no baseline to
     compare against
   - if a file was opened in raw mode but the reviewer wants the diff view and a
     baseline exists, re-open the same file in the matching diff mode before
     continuing
   - read the Quill output
   - persist the result to the session file immediately
6. After each file, pause before moving on. Never open the next file
   automatically.
7. When the walk ends, run session synthesis.

## Per-file outcomes

### Approve

Approve means: **the reviewer is done with this file for now**.

- record the annotations in the session file
- do not block on unresolved agent annotations
- summarize the file briefly in the TUI
- ask whether to continue to the next file

### Deny

Deny means: **pause the walk and discuss this file before moving on**.

When denied:

1. Read all user annotations and replies carefully.
2. Process everything in the TUI first:
   - answer `question` annotations inline in the TUI
   - apply requested changes from `instruct`
   - acknowledge/incorporate `comment`
3. Prepare updated annotations after discussion or edits.
4. Ask whether to re-open the same file for verification.
5. Re-open in Quill only after confirmation.
6. Keep stable annotation `id` values when carrying items forward.

Do not try to continue the conversation inside Quill replies.

### Abort

Abort means: **stop the review walk immediately**.

- do not open more files
- do not re-open the current file
- go straight to session synthesis with whatever is already recorded

## Between-file confirmation

After every approved file, or denied-then-reapproved cycle, pause and ask:

- continue to next file?
- stop and synthesize now?

This pause is mandatory.

## Annotation policy

Corrections only:

- annotate bugs, logic issues, edge cases, design concerns, style violations
- do not annotate to explain changes, praise code, or add informational noise
- zero annotations on a clean file is a good outcome
