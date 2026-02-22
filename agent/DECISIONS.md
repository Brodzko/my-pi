# DECISIONS

Capture durable architecture/product decisions.
Avoid logging temporary implementation details.

## Entry Template
- ID: DEC-YYYYMMDD-XX
- Scope: repo | package | feature
- Tags: [area, package, architecture]
- Date:
- Decision:
- Context:
- Alternatives considered:
- Tradeoffs:
- Trigger (when to revisit):
- Follow-up:

---

- ID: DEC-20260222-01
- Scope: repo
- Tags: [workflow, collaboration, reviews]
- Date: 2026-02-22
- Decision: Apply small review-driven code changes immediately without approval; ask for approval only for larger refactors, architecture changes, or rewrites.
- Context: During iterative review, waiting for approval on tiny edits slows feedback loops and adds unnecessary friction.
- Alternatives considered:
  - Always ask before any change during review.
  - Never ask (including major changes).
- Tradeoffs:
  - Faster iteration on minor fixes.
  - Requires clear judgment boundary for what counts as major/high-risk.
- Trigger (when to revisit): If review churn increases due to misclassified “small” changes.
- Follow-up: Treat explicit “remember this” user instructions as durable memory and persist them to memory files by default.

- ID: DEC-20260222-02
- Scope: repo
- Tags: [typescript, code-organization, maintainability]
- Date: 2026-02-22
- Decision: Avoid generic `types.ts`-style files by default; colocate types with the module where they are most relevant, and introduce shared type modules only when truly necessary (e.g., to break cycles or represent a stable shared contract).
- Context: Centralized catch-all type files make ownership and intent unclear and tend to grow into dumping grounds.
- Alternatives considered:
  - Keep all extension types in a single `types.ts`.
  - Inline all types everywhere without reuse.
- Tradeoffs:
  - Better locality/readability and clearer ownership of type contracts.
  - Some cross-file type imports remain, requiring discipline to avoid accidental cycles.
- Trigger (when to revisit): If type duplication or import complexity materially increases in a package.
- Follow-up: During review, prefer moving types to the closest module when touching related code.
