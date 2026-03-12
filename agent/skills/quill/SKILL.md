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

- A workflow skill (e.g. `review-files`, `review-merge-request`) instructs you
  to open a file for review
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

| Field       | Required | Description                                                                                   |
| ----------- | -------- | --------------------------------------------------------------------------------------------- |
| `id`        | No       | Stable identifier. Auto-generated UUID if omitted. Provide when you need round-trip tracking. |
| `startLine` | Yes      | First line of the annotated range (1-indexed).                                                |
| `endLine`   | Yes      | Last line of the annotated range (>= startLine).                                              |
| `intent`    | Yes      | What kind of annotation this is (see below).                                                  |
| `category`  | No       | Classification of the concern (see below).                                                    |
| `comment`   | Yes      | The annotation text. Be specific and reference the code.                                      |
| `source`    | No       | Who created it. Defaults to `"agent"`.                                                        |
| `replies`   | No       | Array of `{ comment, source }` objects.                                                       |
| `metadata`  | No       | Pass-through object. Quill preserves but does not interpret it.                               |

### Intents

| Intent        | Use when...                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `instruct`    | You are telling the user to do something (rare — usually the user instructs you) |
| `question`    | You are asking the user a question about the code                                |
| `comment`     | You are making an observation or noting something                                |
| `praise`      | You are highlighting something well done                                         |
| `suggestion`  | You are proposing a concrete change                                              |
| `uncertainty` | You are flagging code you're unsure about and want human review                  |

### Categories

Categories optionally classify the concern: `bug`, `security`, `performance`,
`design`, `style`, `nitpick`. Use them only when they help prioritize the
annotation.

## Output: what comes back

When the user finishes, the tool returns raw JSON from Quill. The output is a
JSON object with the file, mode, decision, and all annotations.

### Base semantics

**`decision`**:

- `"approve"` — the user is done with this file in the current interaction
- `"deny"` — the user wants to pause and discuss or iterate before moving on
- `null` / aborted result — the user cancelled Quill

**Annotations from the user** (`source: "user"`):

| User intent | Base meaning                                        |
| ----------- | --------------------------------------------------- |
| `instruct`  | Direct request to change or do something            |
| `question`  | Question to answer in the normal TUI conversation   |
| `comment`   | Feedback or context to consider                     |
| `praise`    | Positive feedback; usually just acknowledge briefly |

**Replies on your annotations** preserve the conversation thread around an
existing annotation.

## Interpreting output in different workflows

Quill defines the **base semantics**. The parent workflow decides what they mean
operationally.

### Single-file inspection

- `approve` → the user is done with the file; respond in the TUI and stop
- `deny` → discuss, answer questions, make edits if requested, then optionally
  re-open the same file if the user wants verification
- abort → stop the inspection

### Multi-file review

- `approve` → record the file and ask whether to continue to the next file
- `deny` → pause the walk, process feedback in the TUI, then optionally re-open
  the same file
- abort → end the entire review walk

### Pre-commit review

- `approve` → that file is clear for the current commit review
- `deny` → the commit gate is paused until feedback is resolved or the user
  explicitly chooses to proceed anyway
- abort → stop the pre-commit gate and hand control back to the caller

Quill itself does not define session files, between-file confirmation, GitLab
comment synthesis, or commit-gate semantics. Those belong to the parent review
workflow skill.

## Answering questions

When the user asks a question via an annotation, answer it **inline in the TUI
conversation** — not inside Quill. For each question:

1. Output the highlighted code from the annotated line range.
2. Output the question itself.
3. Output your answer.

Any follow-up discussion or code changes should happen in the TUI before you
consider re-opening Quill.

## Round-trip conversations

When re-opening a file after discussion or edits:

1. Process everything in the TUI first.
2. Make any requested code changes.
3. Prepare updated annotations.
4. Re-open the file only if the workflow or user asks for verification.
5. Provide stable `id` values for continuity when carrying annotations forward.

## Diff mode

When reviewing changes against a baseline:

```
quill_review(file: "src/app.ts", diffRef: "main")
quill_review(file: "src/app.ts", staged: true)
quill_review(file: "src/app.ts", unstaged: true)
```

Only one diff flag at a time. Quill shows a diff view and annotations attach to
the new-file-side line numbers. If no diff is found, Quill falls back to raw
mode.

For review workflows, prefer a diff mode whenever a baseline exists. Raw mode
is mainly for entirely new files or file inspection without a meaningful
comparison target. If a file was opened raw and the reviewer asks to see the
change against its baseline, re-open it with the appropriate diff flag.

## Writing good annotations

- Be specific and reference the actual code.
- Prefer one concern per annotation.
- Use the narrowest correct intent.
- Keep comments concise.
- Annotate ranges when the concern spans a block.
