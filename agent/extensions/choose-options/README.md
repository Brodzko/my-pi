# choose-options

Generic finite-choice extension for pi.

## Tool

`choose_options`

### Input

- `prompt: string`
- `options: Array<{ id: string; label: string; hint?: string }>`
- `multi?: boolean` (default: `false`)

### Output (`details`)

- `selected: Array<{ id: string; label: string; hint?: string }>`
- `cancelled: boolean`

## UX

- Interrupts the current turn and waits for user submission.
- Single-select: `↑/↓` move, `enter` select, `esc` cancel.
- Multi-select: `↑/↓` move, `space` toggle, `enter` submit, `esc` cancel.
- `hint` is rendered as muted secondary text for structured options like:
  - `label: "[!1234] Refactor auth"`
  - `hint: "2026-02-27 • draft • martin"`

## Demo command

- `/choose-demo` → opens single-select demo with MR-like options.
- `/choose-demo --multi` (or `/choose-demo -m`) → opens multi-select demo.

## Example tool call input

```json
{
  "prompt": "Pick merge requests to review",
  "multi": true,
  "options": [
    {
      "id": "1234",
      "label": "[!1234] Refactor auth",
      "hint": "2026-02-27 • draft"
    },
    {
      "id": "1258",
      "label": "[!1258] Improve parser",
      "hint": "2026-02-26 • ready"
    }
  ]
}
```
