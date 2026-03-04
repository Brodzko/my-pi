---
name: session-query
description: Query another pi session when the current conversation lacks enough context.
---

Use `query_session` when the user asks about details from another session and the answer cannot be derived confidently from the current context.

## When to use

- The user references another session by UUID (`@@<uuid>`) or exact name.
- The user asks what was decided, changed, or concluded in earlier work.
- You would otherwise need to guess about prior-session content.
- After a `/handoff`, the prefill includes the source session UUID — use it directly.

## How to use

- Prefer **one focused call** first.
- The `session` parameter must be a **session UUID** or an **exact session name**. Descriptive text, partial names, or topic keywords will not match.
- If a handoff prefill includes a source session ID (e.g. `This session was handed off from session <uuid>`), use that UUID directly.
- Ask a narrow question that can be answered with concrete evidence.

## Common mistakes

- **Do NOT guess session names** from topic context (e.g. `"quill"`, `"Continue Phase 2.4 work..."`). These will fail with `SESSION_NOT_FOUND`.
- If you don't have a session UUID, say so explicitly rather than fabricating one.

## Result handling

- Treat returned citations as evidence anchors.
- If confidence is low or evidence is missing, state uncertainty explicitly.
- Do not invent details that are not grounded in tool output.

## Example

- `query_session(session: "2f3d4a1e-bb34-40c0-8c2e-6b7faa12783b", question: "What was the decision about extension layout and why?")`
