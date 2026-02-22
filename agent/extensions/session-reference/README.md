# session-reference

Resolves `@@<session-uuid>` references from the user prompt and injects referenced session summaries into model context for the same turn.

## What it does

- Hooks into `before_agent_start`.
- Parses UUID-only references in prompt text (`@@xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
- Deduplicates by UUID, preserves first-seen order, applies `maxRefsPerPrompt` cap.
- Resolves from `~/.pi/agent/sessions-meta/<uuid>.meta.json`.
- Injects one aggregated custom message when at least one reference resolves.
- Never fails the turn because of missing/invalid references.

## Injection behavior

Returns from `before_agent_start`:

```ts
{
  message: {
    customType: 'session-reference',
    content: 'Referenced session summaries: ...',
    display: debugDisplayInjectedMessage,
    details: { sessionIds: [...] }
  }
}
```

Notes:

- Message is persistent custom message context for the turn.
- `display` is `false` by default (hidden in TUI).
- Payload is byte-limited by `maxInjectedBytes` and appends a truncation note when needed.

## Resolved payload fields

For each resolved reference:

- session id
- name
- updatedAt
- description
- summary
- tags

## Resolution outcomes

- `resolved`
- `not_found`
- `invalid_meta`
- `over_limit` (synthetic reason for references beyond `maxRefsPerPrompt`)

## UX + telemetry

Status examples:

- `✅ resolved X reference(s)`
- `⚠️ failed to resolve Y reference(s)`
- mixed message when both happen

Telemetry:

- `customType: "session-reference:inject"`
- includes: success, resolvedCount, unresolvedCount, unresolved reason counters, injectedBytes, truncated, timestamp

## Config

File: `session-reference.config.json`

```json
{
  "enabled": true,
  "statusKey": "session-reference",
  "notificationAutoClearMs": 3000,
  "maxRefsPerPrompt": 3,
  "maxInjectedBytes": 12000,
  "debugDisplayInjectedMessage": false
}
```

Invalid config disables behavior safely and warns once per session.

## Local scripts

- `npm run format`
- `npm run lint`
- `npm run tsc`
- `npm run test`
