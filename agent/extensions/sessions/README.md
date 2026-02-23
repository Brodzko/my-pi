# sessions extensions

Colocated session-related extensions:

- `session-index` — generates and persists session metadata in `~/.pi/agent/sessions-meta`.
- `session-query` — exposes the `query_session` tool for focused cross-session Q&A.
- `session-reference` — resolves `@@<session-id>` references and injects summaries.
- `session-name-widget` — displays the current session name above the editor.
- `session-notify` — plays a completion sound and shows turn duration in TUI-only status/notification.

Group-local shared utilities live in `shared/`. Cross-extension utilities shared with other extension groups (for example `quick-open`) live in `../shared/`.

## Entry points

Configured in `package.json` under `pi.extensions`:

- `./session-index/src/index.ts`
- `./session-query/src/index.ts`
- `./session-reference/src/index.ts`
- `./session-name-widget/src/index.ts`
- `./session-notify/src/index.ts`

## Scripts

Run from `agent/extensions/sessions`:

- `npm run format`
- `npm run lint`
- `npm run tsc`
- `npm run test`
