# session-notify

Plays a sound when an agent run finishes and shows a TUI-only duration message.

## Behavior

- Captures start time on `agent_start`.
- On `agent_end`:
  - plays a terminal bell (`\x07`) when enabled,
  - shows a transient UI notification with elapsed time,
  - writes the same message to footer status and auto-clears it.
- Does not inject any message into LLM context.

## Config

File: `session-notify.config.json`

```json
{
  "enabled": true,
  "statusKey": "session-notify",
  "notificationAutoClearMs": 4000,
  "soundMode": "auto",
  "bellCount": 1
}
```

- `enabled`: enables/disables the extension.
- `statusKey`: footer status slot key.
- `notificationAutoClearMs`: footer status auto-clear delay.
- `soundMode`: `"auto"` (OSC notification + bell fallback), `"terminal-osc"`, or `"terminal-bell"`.
- `bellCount`: number of bell characters emitted per completion.
