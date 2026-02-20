# Session Memory Extension — Implementation Plan

## Overview

Three phases, each independently useful.

### Current status (2026-02-20)

- ✅ **Phase 1 is complete and implemented** in `agent/extensions/session-index`.
- ⏭️ **Phase 2 and 3 are not started** yet.

---

## Phase 1 — Auto-metadata generation (implemented contract)

This section is intentionally compact and defines the stable contract future phases/agents
should rely on.

### Extension location

```
~/.pi/agent/extensions/session-index/
  package.json
  session-index.config.json
  src/
    index.ts
    config.ts
    serialize.ts
    generate.ts
    meta.ts
    debug-log.ts
```

### Runtime behavior

- Trigger: `agent_end`.
- Force command: `/${commandName}` (currently `/index-session`) and uses `ctx.waitForIdle()`.
- Ephemeral sessions are skipped when `ctx.sessionManager.getSessionFile() === undefined`.
- Regeneration threshold: at least `minNewUserMessages` (default `5`) user-role messages since
  `lastIndexedLeafId`.
- Branch source: `ctx.sessionManager.getBranch()` (root → leaf).

### Serialization contract

- Indexing input includes only `message` entries with role `user` or `assistant`.
- From message content, only `text` blocks are included.
- Tool calls, thinking blocks, bash/tool result payloads, and non-message entries are excluded.
- Serialized conversation is capped with `truncateTail(..., { maxBytes: DEFAULT_MAX_BYTES })`
  to keep the most recent context.

### Generation contract

- Metadata schema fields:
  - `name`
  - `description`
  - `summary`
  - `tags`
- Model output must be valid JSON and Zod-valid.
- Malformed output retry policy: up to 2 retries (3 attempts total).
- Transport/provider errors are not auto-retried.

### Config contract

Loaded from `session-index.config.json` and validated with Zod.

Supported fields:

- `commandName`
- `statusKey`
- `minNewUserMessages`
- `notificationAutoClearMs`
- `modelKeys` (ordered preferred model keys, currently pinned to Gemini Flash)

Behavior:

- Invalid config: startup warning + indexing path safely no-ops.
- Missing configured model(s): startup warning + indexing path safely no-ops.

### Persistence contract

Meta files:

```
~/.pi/agent/sessions-meta/<session-uuid>.meta.json
```

Meta payload shape:

```ts
type MetaFile = {
  sessionId: string;
  sessionFile: string;
  parentSessionFile: string | undefined;
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

I/O guarantees:

- Writes are atomic via temp file + rename.
- Existing invalid/corrupt meta files are treated as missing and surfaced as a warning.
- Invalid-meta warning is logged and shown to user; successful reindex rewrites the file.

### UI + telemetry contract

- Status line uses configured `statusKey`.
- On success: includes formatted USD cost.
- On failure: readable error status.
- Indexing attempts emit custom telemetry entries:
  - `customType: "session-index:index"`
  - includes `success`, `sessionId`, `model`, `timestamp`, optional `usage`, optional `error`.

### Testing status

Implemented with Vitest:

- `src/serialize.test.ts` — serialization/filtering + truncation behavior.
- `src/meta.test.ts` — read/write I/O behavior + invalid file handling.

### Implications for next phases

- Phase 2/3 should treat the meta file shape above as the stable integration boundary.
- If adding config in future phases, follow the same JSON + Zod + startup-warning pattern.
- Reuse/extend telemetry in backward-compatible way (`session-index:index`).
- Avoid introducing parallel write paths to the same meta files without lock/queueing.

---

## Phase 2 — Session reference injection (`@@`)

### What it does

Intercepts user messages, detects `@@<session-name-or-id>` references, resolves them to a
session summary, and injects that summary into context before the model sees the message.

### Resolution order

1. Exact UUID match against meta file names
2. Case-insensitive name match against `name` field in meta files
3. Fuzzy match on `name` — return ambiguous match error if multiple candidates

### Injection mechanism

Use the `input` event to intercept and transform the message:

```
user types: "should we use the same approach as @@confirm-button-refactor?"

input handler:
  → detects @@confirm-button-refactor
  → resolves to sessions-meta/<uuid>.meta.json
  → reads summary field
  → transforms message to include injected context

model sees:
  [injected context block]
  ---
  should we use the same approach as @@confirm-button-refactor?
```

Alternatively, inject via `before_agent_start` as a `custom_message` entry (stored in session
JSONL). **This is the preferred approach for cache reasons — see below.**

### Cache-friendliness — needs discussion

Two injection strategies with different caching behaviour:

**Option A — Append to user message text (via `input` transform)**
Simple but dirty. The summary text becomes part of the user message. Not stored separately.
Not cache-friendly — the message is new content every time.

**Option B — Inject as `custom_message` via `before_agent_start`**
The summary is written as a `custom_message` entry into the session JSONL. On the first
reference it costs full tokens. On all subsequent turns it's part of conversation history and
sits in the prompt cache prefix — subsequent turns pay cache-read price (much cheaper).
Cleaner separation: the user message stays unchanged, context injection is a separate entry.

**Open question:** Anthropic/OpenAI cache based on stable prefix. If the injected
`custom_message` is always at the same position in conversation history (because it's stored
in the session), it should cache reliably. Need to verify that inserting a `custom_message`
mid-conversation doesn't break the cache prefix for messages that came after it. This needs
testing or a closer read of how `buildSessionContext()` orders entries.

### Parent chain traversal

If the resolved session has a `parentSessionFile`, consider whether to also inject the
parent's summary. Default: **no** — inject only the directly referenced session. Reason:
the referenced session's summary should already contain inherited context if it was generated
with parent context awareness (see phase 1 open question).

Explicit chain traversal available as syntax sugar: `@@session-name~2` meaning "this session
and 2 levels of ancestors." Probably not needed initially.

---

## Phase 3 — Targeted session query (`query_session`)

### What it does

A tool the model can call (or that gets called during `@@` resolution when the summary isn't
precise enough). Takes a session ID and a question. Loads the full session JSONL, serializes
it with pi's `serializeConversation()`, sends it to a cheap model with the question, returns
the answer.

### When it's used

- Explicitly: user writes `@@session-name: what did we decide about race conditions?` — the
  question is extracted and passed directly to `query_session`
- As fallback: after injecting a summary, if the model determines the summary doesn't answer
  the current question, it calls `query_session` as a tool

### Tool shape (rough)

```typescript
query_session({
  sessionId: string,   // UUID or name
  question: string,    // What to ask about this session
})
// returns: string answer from cheap model
```

### Cost and latency

Full session serialization can be 20–50k tokens into the cheap model. At Haiku/Flash
pricing, fractions of a cent. But it adds ~1–2s latency per call. Acceptable for explicit
use, would be noticeable if called in a loop.

### Open questions

- Where does the answer get injected? As a `custom_message` (same cache strategy as phase 2)?
  As a tool result returned directly to the model?
- Should there be a token cap on how much of the session gets sent? If the session is huge,
  send the most recent N tokens + any compaction summaries embedded in it.
- The cheap model might not have access to the same tool call outputs (they can be verbose).
  `serializeConversation()` already handles this — but tool results may be truncated in the
  serialization. Acceptable for now.

---

## What is explicitly out of scope (for now)

- Vector embeddings / semantic search
- `search_sessions` (autonomous proactive retrieval) — uncertain ROI, revisit later
- Memory visualisation UI
- Memory editing / deletion (the meta files are plain JSON — deletable manually for now)
- Cross-project search
