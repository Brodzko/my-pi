# Review loop protocol

Use this protocol for **multi-file** Quill review workflows.

Before starting:

- read `../../quill/SKILL.md`
- read `../REVIEWER.md`
- read `./session-file.md`

## Critical invariants

These rules are **non-negotiable** and override any other consideration:

1. **Abort means stop entirely.** If `quill_review` returns `null` or the
   decision is absent/aborted, the review walk is **over**. Do not open another
   file. Do not re-open the current file. Do not ask "continue?". Go directly
   to session synthesis with whatever is already recorded, or simply stop if
   nothing was recorded.

2. **Always pause between files.** After processing each file (approve or
   deny→resolve cycle), you **must** stop and ask the user whether to continue
   before opening the next file. Use `choose_options` for this gate. Never
   call `quill_review` for the next file without an explicit user go-ahead.

3. **One `quill_review` call at a time.** Never queue or batch multiple
   `quill_review` calls. Wait for the current one to resolve, process its
   output fully, run the between-file pause, and only then consider the next.

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
   - **if aborted → stop immediately** (see critical invariant 1)
   - persist the result to the session file immediately
6. **Mandatory pause** — after each file, ask the user whether to continue
   (see critical invariant 2). Never open the next file automatically.
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

Abort means: **stop the review walk immediately. This is absolute.**

- do **not** open more files
- do **not** re-open the current file
- do **not** ask "continue?" or "want to review more?"
- do **not** call `quill_review` again for any reason
- go straight to session synthesis with whatever is already recorded, or simply
  stop if nothing was recorded

If you are uncertain whether the output represents an abort, treat it as an
abort. Err on the side of stopping.

## Between-file confirmation

After every approved file, or denied-then-reapproved cycle, you **must**:

1. **Report progress.** Before the prompt, print a short progress line showing
   the current position and total, e.g. `✔ 3/10 — src/utils/parse.ts`. This
   lets the user know where they are in the walk at a glance.
2. **Ask to continue** using `choose_options` with **three options**:

   - **Continue** — open the next file in the walk
   - **Stop & synthesize** — end the walk and run session synthesis
   - **Pause — I have a question / instruction** — stop the walk and hand control
   back to the user in the TUI. The user may ask questions, give instructions,
   request code changes, or discuss what they've seen so far. After the
   conversation resolves, ask the same three-option question again to let the
   user resume, stop, or pause again.

**This pause is mandatory and non-negotiable.** Never skip it. Never open the
next file without explicit user confirmation. The user controls the pace of
the review, not the agent.

## Annotation policy

Corrections only:

- annotate bugs, logic issues, edge cases, design concerns, style violations
- do not annotate to explain changes, praise code, or add informational noise
- zero annotations on a clean file is a good outcome
