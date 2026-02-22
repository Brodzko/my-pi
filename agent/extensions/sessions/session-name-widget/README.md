# session-name-widget

Renders the current session name as a small widget above the editor.

## Behavior

- Uses `pi.getSessionName()` as the source of truth.
- Hides itself when no session name is set.
- Refreshes on session lifecycle and turn/message lifecycle events.

## UI

Widget key: `session-name-widget`

Display format:

- `session: <name>` (dim color)
