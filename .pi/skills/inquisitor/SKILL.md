---
name: inquisitor
description: Use this skill when you need finite user input (single or multi choice). It enforces using the choose_options tool for constrained decisions while avoiding unnecessary prompts for obvious or purely technical defaults.
---

# Inquisitor

Use this skill whenever progress depends on a **finite user choice**.

## Core policy

- If the question can be represented as a bounded list of options, call `choose_options`.
- Prefer `choose_options` over free-form text when selecting one/many among concrete alternatives.
- Do **not** use `choose_options` when:
  - no real decision is needed (only one sensible path),
  - the user asked an open-ended question,
  - discovery/brainstorming is needed before options exist,
  - a pure yes/no confirmation is enough (`confirm` style interaction is better).

## Decision rubric (quick)

Use `choose_options` if all are true:
1. You need user input to continue.
2. You can list 2+ concrete choices now.
3. Returning selected IDs would unblock the next action.

Otherwise, ask a normal question or proceed with a justified default.

## Tool contract

Call tool `choose_options` with:

- `prompt: string`
- `options: Array<{ id: string; label: string; hint?: string }>`
- `multi?: boolean`

Expect result details:

- `selected: Array<{ id: string; label: string; hint?: string }>`
- `cancelled: boolean`

## Option quality rules

- Keep options mutually exclusive when possible.
- Use stable IDs (`mr-1234`, `pkg-zod`, `approach-a`).
- Put primary text in `label`, metadata in `hint`.
- Keep labels short and scannable.
- For long lists, include only relevant candidates (top N).
- Include an `other` option only when genuinely useful.

## Examples

### Pick one MR

- `multi: false`
- options: `[{ id: "mr-1234", label: "[!1234] Refactor auth", hint: "ready • 2026-02-27" }, ...]`

### Pick packages

- `multi: true`
- options: `[{ id: "pkg-zod", label: "zod", hint: "schema validation" }, { id: "pkg-valibot", label: "valibot", hint: "schema validation" }]`

## After selection

- If `cancelled: true`, explain what was blocked and ask whether to retry.
- If selected is empty in multi mode, treat as explicit "none selected" and confirm next step.
- Continue immediately using selected IDs/options; do not re-ask the same decision.
