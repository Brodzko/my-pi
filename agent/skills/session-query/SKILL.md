---
name: session-query
description: Query another pi session when the current conversation lacks enough context.
---

Use `query_session` when the user asks about details from another session and the answer cannot be derived confidently from the current context.

## When to use

- The user references another session by UUID (`@@<uuid>`) or exact name.
- The user asks what was decided, changed, or concluded in earlier work.
- You would otherwise need to guess about prior-session content.

## How to use

- Prefer **one focused call** first.
- Provide a specific `session` target (UUID or exact name when possible).
- Ask a narrow question that can be answered with concrete evidence.

## Result handling

- Treat returned citations as evidence anchors.
- If confidence is low or evidence is missing, state uncertainty explicitly.
- Do not invent details that are not grounded in tool output.

## Example

- `query_session(session: "2f3d...", question: "What was the decision about extension layout and why?")`
