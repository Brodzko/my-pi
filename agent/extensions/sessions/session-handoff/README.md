# session-handoff

Provides `/handoff` command to generate a continuation-ready summary of the current thread and open a new session with that summary prefilled in the editor.

## Command behavior

Command name defaults to `/handoff` and accepts optional free-form text:

```txt
/handoff {optional-instruction}
```

Execution flow:

1. Serialize current session branch conversation (user/assistant text only).
2. Derive touched file hints from assistant tool calls (`path`, `paths`, `file`, `files` args).
3. Generate structured handoff markdown with sections:
   - `## Goal`
   - `## Progress`
   - `## Hurdles`
   - `## Touched Files`
   - `## Next Steps`
4. Start a new session (`newSession`) with parent linkage to the previous session when available.
5. Prefill the new session editor with:
   - generated handoff markdown,
   - explicit guidance to use `query_session` for deeper context,
   - appended optional instruction (if provided).

The first message is **not auto-submitted**; it is prefilled so the user can review/edit before sending.

## Generation details

- Uses configured text model(s) from `modelKeys`.
- Follows the same generation pattern as `session-index`: JSON schema validation and retry on malformed output (up to 3 attempts total).
- Emits telemetry entries:
  - `session-handoff:attempt` for each generation attempt
  - `session-handoff:generate` for final command outcome

## Config

File: `session-handoff.config.json`

```json
{
  "enabled": true,
  "commandName": "handoff",
  "statusKey": "session-handoff",
  "notificationAutoClearMs": 4000,
  "modelKeys": ["openai-codex/gpt-5.1-codex-mini", "openai-codex/gpt-5.1"],
  "maxBytes": 260000
}
```

## Local scripts

Run from `agent/extensions/sessions`:

- `npm run format`
- `npm run lint`
- `npm run tsc`
- `npm run test`
