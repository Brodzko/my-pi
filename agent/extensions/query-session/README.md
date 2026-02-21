# query-session

Provides `query_session` tool for focused Q&A over a previous session (by UUID or exact session name).

## Tool contract

Tool name: `query_session`

Args:

```ts
type QuerySessionArgs = {
  session: string; // UUID or exact session name
  question: string;
};
```

Result:

```ts
type QuerySessionResult = {
  sessionId: string;
  sessionName: string;
  answerMarkdown: string;
  confidence: 'high' | 'medium' | 'low';
  citations?: Array<{
    entryId: string;
    role: 'user' | 'assistant';
    excerpt: string;
  }>;
  notes?: string[];
};
```

## Runtime behavior

- Tool is registered only when config is valid and `enabled=true`.
- Model availability is checked on `session_start`, `session_switch`, and `model_select`.
- Per-turn call counter resets on `agent_start`.
- Adds one system prompt hint in `before_agent_start` when operational:
  - prefer using `query_session` once for cross-session questions / `@@...` references.

## Resolution + loading

- Discovers sessions from current session directory (`*.jsonl`).
- Optional metadata overlay from `~/.pi/agent/sessions-meta` when `useSessionsMeta=true` (for better display names).
- Resolves target by:
  - exact UUID, or
  - exact case-insensitive session name.
- Ambiguous exact-name matches fail with candidates.
- Loads target branch entries from session file and serializes only user/assistant text.

## Generation + safeguards

- Uses first available model from configured `modelKeys`.
- Applies timeout to model call via `timeoutMs`.
- Retries malformed model output up to 2 times (3 attempts total).
- Enforces `maxCallsPerTurn` (current max allowed by schema is 2).
- Truncates serialized context to `maxBytes` and reports truncation in `notes`.

## Errors

Structured error codes include:

- `INVALID_ARGS`
- `CALL_LIMIT_EXCEEDED`
- `SESSION_NOT_FOUND`
- `SESSION_AMBIGUOUS`
- `SESSION_FILE_MISSING`
- `SESSION_PARSE_FAILED`
- `SESSION_EMPTY`
- `QUERY_MODEL_UNAVAILABLE`
- `QUERY_TRANSPORT_FAILED`
- `QUERY_INVALID_OUTPUT`
- `UNKNOWN_QUERY_SESSION_ERROR`

## Telemetry + status

Telemetry entries:

- `customType: "query-session:query_session"`
- includes success/failure, timing, model, usage, truncation info, and error

Status line:

- start: `querying another session...`
- success: `query_session done ($X.XXXX)`
- failure: `query_session failed: <reason>`

## Config

File: `query-session.config.json`

```json
{
  "enabled": true,
  "statusKey": "query-session",
  "notificationAutoClearMs": 3000,
  "modelKeys": ["openai-codex/gpt-5.1-codex-mini", "openai-codex/gpt-5.1"],
  "maxBytes": 160000,
  "maxCallsPerTurn": 1,
  "timeoutMs": 30000,
  "useSessionsMeta": true
}
```

Note: schema default timeout (if omitted) is currently `15000`; this repo config sets it to `30000`.

## Local scripts

- `npm run format`
- `npm run lint`
- `npm run tsc`
- `npm run test`
