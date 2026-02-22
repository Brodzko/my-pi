# LEARNINGS

Capture only high-signal, reusable lessons.
Prefer concise entries with explicit triggers.

## Entry Template

- ID: LRN-YYYYMMDD-XX
- Level: L1 (policy) | L2 (tactic)
- Tags: [area, package, API, error-type]
- Date:
- Context:
- Signal (what failed or what worked):
- Rule (future behavior change):
- Trigger (when this applies):
- Example file/commit:

---

- ID: LRN-20260222-01
- Level: L2 (tactic)
- Tags: [quick-open, editor, insertion, overlay]
- Date: 2026-02-22
- Context: quick-open @ insertion after closing an overlay dialog
- Signal (what failed or what worked): `pasteToEditor()` triggered native picker side effects; delayed `setEditorText()` updates sometimes rendered only on next keypress because `setEditorText()` itself does not request a render
- Rule (future behavior change): Prefer synchronous `setEditorText()` right after dialog result resolution, and rely on an immediate known render trigger in the same flow (e.g. status clear in `finally`)
- Trigger (when this applies): Programmatic editor text updates after overlay/custom UI dismissal
- Example file/commit: agent/extensions/quick-open/index.ts

- ID: LRN-20260222-02
- Level: L2 (tactic)
- Tags: [quick-open, ui, scrolling, list-window]
- Date: 2026-02-22
- Context: quick-open dialog list with an optional "↓ N more" row
- Signal (what failed or what worked): Scroll clamping based on `MAX_VISIBLE` hides the selected item when one slot is consumed by the "more" indicator row
- Rule (future behavior change): Clamp selection against _effective visible item slots_ (dynamic), not static max rows
- Trigger (when this applies): Any list view that conditionally reserves rows for hints/overflow indicators
- Example file/commit: agent/extensions/quick-open/src/dialog.ts

- ID: LRN-20260222-03
- Level: L1 (policy)
- Tags: [communication, memory, workflow]
- Date: 2026-02-22
- Context: User explicitly asked the agent to remember workflow preferences across sessions.
- Signal (what failed or what worked): Keeping it only in transient chat context is not durable.
- Rule (future behavior change): When user explicitly says to "remember" a behavioral preference/rule, persist it immediately into memory files (`DECISIONS.md` or `LEARNINGS.md`) instead of only acknowledging in chat.
- Trigger (when this applies): Any explicit user instruction to remember a reusable behavior or preference.
- Example file/commit: agent/DECISIONS.md (DEC-20260222-01)

- ID: LRN-20260222-04
- Level: L2 (tactic)
- Tags: [quick-open, fuzzy, multi-term, ranking]
- Date: 2026-02-22
- Context: Multi-word fuzzy queries (e.g. `session src conf`) ranked short partial paths above intended file matches.
- Signal (what failed or what worked): Counting weak Fuse token hits as full token coverage allowed non-intuitive results to pass AND-style filtering.
- Rule (future behavior change): For multi-term query aggregation, only count token coverage on strong hits (normalized substring or very strong fuzzy score) before applying all-terms prioritization.
- Trigger (when this applies): Tokenized fuzzy search where all-token matches are preferred over partial matches.
- Example file/commit: agent/extensions/quick-open/src/fuzzy.ts
