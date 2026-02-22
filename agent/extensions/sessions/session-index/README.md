# session-index

Auto-generates searchable metadata for the current session and stores it in `~/.pi/agent/sessions-meta/<session-id>.meta.json`.

## What it does

- Runs on `agent_end` (after each user prompt), with lock protection to avoid overlapping runs.
- Skips ephemeral sessions (`ctx.sessionManager.getSessionFile()` is missing).
- Re-indexes only when enough new user messages were added since last index (`minNewUserMessages`).
- Supports manual forcing via `/${commandName}` (default `/index-session`).
- Updates session name via `pi.setSessionName(meta.name)` after successful indexing.

## Input/serialization behavior

- Reads current branch from `ctx.sessionManager.getBranch()`.
- Includes only `message` entries with role `user`/`assistant`.
- Includes only text blocks from message content.
- Excludes tool calls, tool results, thinking blocks, and non-message entries.
- Truncates serialized conversation with `truncateTail(..., { maxBytes: DEFAULT_MAX_BYTES })`.

## Generated metadata

Model is asked to return JSON with:

- `name`
- `description`
- `summary`
- `tags`

Tag generation instructions include entity-style tags when present in conversation, e.g.:

- `ticket:ABC-123`, `ticket:#1234`
- `slack:thread`, `slack:channel`, optionally `slack:<identifier>`

Model output is Zod-validated and malformed output is retried up to 2 times (3 attempts total).

## Meta file shape

```ts
type MetaFile = {
  sessionId: string;
  sessionFile: string;
  parentSessionFile?: string;
  name: string;
  description: string;
  summary: string;
  tags: string[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  lastIndexedLeafId: string;
};
```

Writes are atomic (temp file + rename).

## Config

File: `session-index.config.json`

```json
{
  "commandName": "index-session",
  "statusKey": "index-session",
  "minNewUserMessages": 5,
  "notificationAutoClearMs": 2000,
  "modelKeys": ["openai-codex/gpt-5.1-codex-mini", "openai-codex/gpt-5.1"]
}
```

Schema defaults (when keys are omitted) come from `src/config.ts`.

## Telemetry + status

- Appends telemetry entries with `customType: "session-index:index"`.
- Telemetry includes success/failure, session id, model, timestamp, usage, optional error.
- Status line uses configured `statusKey` and auto-clears after `notificationAutoClearMs`.
- Invalid config / unavailable model disables indexing with warnings (no hard failure).

## Local scripts

- `npm run format`
- `npm run lint`
- `npm run tsc`
- `npm run test`
