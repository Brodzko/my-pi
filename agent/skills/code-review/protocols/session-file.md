# Review session file

Every **multi-file** review creates a session file that accumulates state across
the walk.

## Location

`.brodzko/review-sessions/<timestamp>-<short-description>.json`

## Rules

- Create the session file at the **start** of every multi-file review.
- Update it after each Quill result. Do not reconstruct it at the end.
- Treat it as the source of truth for what was reviewed.
- Single-file inspections do **not** need a session file unless the review grows
  into a multi-file session.

## Minimum structure

```json
{
  "startedAt": "ISO timestamp",
  "entryPoint": "agent-work | mr-review | files-review | pre-commit",
  "diffRef": "optional ref",
  "files": [
    {
      "path": "src/parser.ts",
      "order": 1,
      "decision": "approve",
      "annotations": []
    }
  ],
  "aborted": false,
  "synthesis": null
}
```

## Semantics

- `decision: null` means the file was not reached before abort.
- `annotations` must preserve both agent and user annotations returned by Quill.
- `synthesis` should hold the final session summary once generated.

Use this file for follow-up questions like "what did we review?" or "what is
still unresolved?".
