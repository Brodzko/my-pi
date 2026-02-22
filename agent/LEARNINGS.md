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
- Signal (what failed or what worked): `pasteToEditor()` triggered native picker side effects in this path, while deferred `setEditorText()` avoided that but can need a one-frame retry for consistent render
- Rule (future behavior change): For programmatic quick-open insertions, prefer deferred `setEditorText()` with idempotent retry over `pasteToEditor()`
- Trigger (when this applies): Inserting tags/text immediately after custom overlay dismissal
- Example file/commit: agent/extensions/quick-open/index.ts
