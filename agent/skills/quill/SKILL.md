---
name: quill
description: Terminal file reviewer with structured annotations. Use when you need the user to review a file, give feedback on code, or when interpreting annotation output from a quill session. Reference skill for quill-based workflows.
---

# Quill

Quill is a terminal file reviewer — JSON in, JSON out. It opens a file in a
read-only syntax-highlighted viewer where the user creates, edits, and responds
to line-level annotations.

Use it whenever you need structured human feedback on code.

## When to use quill

**Only use quill when explicitly triggered.** Do not open quill spontaneously
after making code changes — use normal text responses for that.

Valid triggers:

- A workflow skill (e.g. code-review) instructs you to open a file for review
- The user explicitly asks to review, annotate, or discuss a file in quill
- The user asks you to present observations on a file using quill

## Invocation

**Use the `quill_review` tool.** Do not call `quill` via bash — it is an
interactive TUI that requires terminal handoff.

```
quill_review(
  file,                    # path to the file to review (required)
  annotations?,            # array of annotation objects to pre-load
  diffRef?,                # diff against a git ref (branch, tag, SHA)
  staged?,                 # diff staged changes
  unstaged?,               # diff unstaged changes
  line?,                   # start cursor at this line (1-indexed)
  focusAnnotation?,        # start focused on annotation by id
)
→ QuillOutput | null       # null on abort (user pressed Ctrl+C)
```

The tool blocks until the user finishes (approve/deny) or aborts.

The user can also open quill directly via the `/quill` command:
```
/quill @src/app.ts
/quill src/app.ts --diff-ref main
/quill src/app.ts --staged
```

## Input: annotations you provide

Each annotation targets a line range and carries an intent, optional category,
and comment.

```json
{
  "annotations": [
    {
      "id": "optional-stable-id",
      "startLine": 10,
      "endLine": 12,
      "intent": "question",
      "comment": "Is this error handling intentional? The catch swallows the original error.",
      "source": "agent"
    },
    {
      "startLine": 25,
      "endLine": 25,
      "intent": "suggestion",
      "comment": "Consider using R.map instead of the manual loop here.",
      "source": "agent",
      "category": "style"
    }
  ]
}
```

### Annotation fields

| Field       | Required | Description                                                                                                                              |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | No       | Stable identifier. Auto-generated UUID if omitted. Provide when you need round-trip tracking (to match replies back to your annotations). |
| `startLine` | Yes      | First line of the annotated range (1-indexed).                                                                                           |
| `endLine`   | Yes      | Last line of the annotated range (>= startLine).                                                                                         |
| `intent`    | Yes      | What kind of annotation this is (see below).                                                                                             |
| `category`  | No       | Classification of the concern (see below).                                                                                               |
| `comment`   | Yes      | The annotation text. Be specific and reference the code.                                                                                 |
| `source`    | No       | Who created it. Defaults to `"agent"`.                                                                                                   |
| `replies`   | No       | Array of `{ comment, source }` objects. Use for ongoing conversations.                                                                   |
| `metadata`  | No       | Pass-through object. Quill preserves but does not interpret it. Use for integration-specific data (thread IDs, permalinks, timestamps).   |

### Intents

| Intent        | Use when...                                                                       |
| ------------- | --------------------------------------------------------------------------------- |
| `instruct`    | You are telling the user to do something (rare — usually the user instructs you)  |
| `question`    | You are asking the user a question about the code                                 |
| `comment`     | You are making an observation or noting something                                 |
| `praise`      | You are highlighting something well done                                          |
| `suggestion`  | You are proposing a concrete change                                               |
| `uncertainty` | You are flagging code you're unsure about and want human review                   |

### Categories

Categories optionally classify the concern: `bug`, `security`, `performance`,
`design`, `style`, `nitpick`. Use when the distinction is meaningful for the
user's prioritization. Omit when it's obvious or not useful.

## Output: what comes back

When the user finishes, the tool returns raw JSON from Quill. The output is a
JSON object with the file, mode, decision, and all annotations (both agent's and
user's).

### Interpreting the output

**`decision`**:

- `"approve"` — the user is done with this file. Move on. Even if there are
  `instruct` annotations, approve means "continue" — record the annotations in
  the session file for later reference but do not block.
- `"deny"` — the user wants to iterate on this file before moving on.

**Annotations from the user** (`source: "user"`): These are the user's feedback.
Process them based on intent:

| User intent | Your action                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `instruct`  | Execute as a code change. This is a direct request.                                                                              |
| `question`  | Answer it inline in the TUI conversation (see § Answering questions below).                                                      |
| `comment`   | Acknowledge and incorporate as context. No action required unless it implies a change.                                            |
| `praise`    | Acknowledge briefly.                                                                                                             |

**Replies on your annotations**: The user responded to something you asked or
flagged. Read the reply in context of your original annotation.

### Answering questions

When the user asks a question via an annotation, answer it **inline in the TUI
conversation** — not inside Quill. For each question:

1. Output the highlighted code from the annotated line range.
2. Output the question itself.
3. Output your answer.

This keeps the conversation flowing naturally. A question might lead to
follow-up discussion which might lead to code changes — all of which should
happen in the TUI before you re-open Quill.

### Abort (null result)

If `quill_review` returns null (or reports abort), the user cancelled. Do not
assume any feedback was given. The review walk ends immediately.

## Round-trip conversations

After processing a denied file's annotations (answering questions, making
changes, discussing in the TUI), prepare to re-open the file in Quill:

1. Make any code changes from `instruct` annotations first.
2. Answer questions and have any necessary discussion in the TUI.
3. Prepare updated annotations — new observations on changed code, carried-over
   unresolved items.
4. Re-open the file with the updated annotation set.
5. Provide stable `id` values so the user sees continuity, not duplicates.

**Rules for re-opening:**

- Process everything in the TUI first, then batch into one re-open.
- Only re-open if the user denied. If they approved, move on — even with
  unresolved annotations.
- After making code changes from `instruct` annotations, re-open with the
  updated file so the user can verify.

## Diff mode

When reviewing changes against a baseline:

```
quill_review(file: "src/app.ts", diffRef: "main")
quill_review(file: "src/app.ts", staged: true)
quill_review(file: "src/app.ts", unstaged: true)
```

Only one diff flag at a time. Quill shows a side-by-side diff view. Annotations
attach to the new-file-side line numbers. If no differences are found, quill
falls back to raw mode (notice on stderr).

Use diff mode when reviewing:

- Code you just wrote (diff against the branch point)
- Staged changes before commit
- MR changes (diff against target branch)

## Writing good annotations

- **Be specific.** Reference the actual code, not just the line numbers.
- **One concern per annotation.** Don't bundle unrelated observations.
- **Use the right intent.** `question` when you genuinely need input,
  `uncertainty` when you want eyes on something, `suggestion` when you have a
  concrete alternative.
- **Keep comments concise.** The user sees them inline next to code — walls of
  text are hard to read in that context.
- **Annotate ranges, not just single lines.** If the concern spans a block, use
  `startLine`/`endLine` to highlight the full range.
