---
name: spec-writer
description: Design and write a markdown implementation spec before coding. Use when the user wants to plan a feature, change, fix, or chore as a structured spec that another agent (or human) can execute without additional context.
---

# Spec Writer

Write a self-contained implementation spec that is clear enough for another
agent to one-shot the work without follow-up questions, and concise enough for a
human reviewer to read and approve in minutes.

## Principles

- **Conversation-driven** — gather context and iterate through dialogue, not
  template filling.
- **Adaptive depth** — scale detail to scope. A one-file fix needs a paragraph,
  not a design doc.
- **Human-reviewable** — concise, scannable, no walls of text. Prefer bullets
  and short sentences.
- **Agent-executable** — unambiguous instructions, concrete file references, and
  a testable definition of done.

## Workflow

### 1. Understand the request

When the user describes what they want to build/change:

1. Read any referenced files, code areas, or existing specs to build context.
2. Check `.specs/` for existing specs that overlap or relate.
3. Check project memory (`.brodzko/memory/`) for relevant prior decisions.
4. Check the current branch and git state for orientation.

### 2. Clarify until confident

Ask focused clarifying questions. Batch related questions together — don't
drip-feed one at a time. Focus on:

- **Ambiguous requirements** — what exactly should happen?
- **Missing boundaries** — what is explicitly out of scope?
- **Unknowns** — are there decisions that need to be made first?
- **Constraints** — backwards compat, perf, specific APIs, no new deps, etc.
- **Verification** — how will we know it works?

Stop asking when you could hand the spec to a competent agent and expect it to
complete the work without asking anything back.

### 3. Name the spec and ensure a branch

Once clarification is sufficient, derive a short working name for the spec. The
name follows the project's branch naming convention (see
`../archivist/conventions.md`):

```
<type>/<ticket>-<short-description>   # e.g. feat/MAT-123-add-line-validation
<type>/<short-description>            # e.g. chore/bump-dependencies
```

Confirm the name with the user before proceeding.

**Branch setup — use the `git-manage-branches` skill.** The branch management
skill owns all branch creation, switching, and upstream tracking. Hand off to it
with these inputs:

- **Target branch name:** the spec name derived above.
- **Base branch:** default to `develop` (or whatever the project convention is)
  unless the user specifies otherwise.

The branch skill will:

1. Fetch latest from origin.
2. Create the branch from `origin/<base>`.
3. Push and set up upstream tracking (`git push -u origin <branch>`).
4. Report back the final state.

If the branch already exists, the branch skill will ask whether to switch to it
or pick a different name — follow its protocol.

**Spec filename:** derive from the branch name by replacing `/` with `-`.

| Branch                              | Spec filename                              |
| ----------------------------------- | ------------------------------------------ |
| `feat/MAT-123-add-line-validation`  | `feat-MAT-123-add-line-validation.md`      |
| `fix/PROJ-456-token-refresh-race`   | `fix-PROJ-456-token-refresh-race.md`       |
| `chore/bump-dependencies`           | `chore-bump-dependencies.md`               |

### 4. Draft the spec

Write the spec to `.specs/<filename>.md` using the format below.

### 5. Review

After writing the spec, tell the user it's ready for review. If the user wants
to review it in quill, open it there. Otherwise, summarize the key points and
ask for feedback inline.

### 6. Iterate

If the user or reviewers provide feedback (inline, in quill annotations, or from
an MR discussion):

1. Read the feedback carefully.
2. For each item: apply the change, explain why it's a no-op, or ask for
   clarification.
3. Update the spec file.
4. Summarize what changed.

## Spec format

Use this structure. **Every section is optional except Goal and Done.** Include
only sections that add value for the specific scope.

```markdown
# <Title>

> One-line summary of what this change accomplishes.

## Context

What exists today that motivates this change. Brief — just enough for someone
unfamiliar with the history to understand the starting point.

## Goal

What we are building/changing and why. Be specific about the desired end state.

## Scope

### In scope
- Concrete deliverables as a bullet list.

### Out of scope
- Things explicitly excluded to prevent drift.

## Plan

Ordered steps to get from current state to goal. Each step should be
independently verifiable where possible.

1. Step one — what to do and why.
2. Step two — what to do and why.
...

## Constraints

Non-obvious rules the implementation must respect (backwards compat, perf
budget, API contracts, no new deps, etc.).

## Affected areas

Files and modules likely touched. Helps reviewers and executing agents
scope their work.

- `path/to/file.ts` — what changes here
- `path/to/other.ts` — what changes here

## Risks & open questions

Unknowns or things that could go wrong. Flag them now so the implementer
handles them deliberately, not accidentally.

## Verification

How to prove the work is correct beyond "tests pass". Specific commands,
edge cases, manual checks.

## Done

- [ ] Checklist item — concrete, testable, binary.
- [ ] Another item.
...

## References

Links to external context: Jira tickets, Slack threads, design docs, PRs,
related specs, documentation.
```

## Handling feedback from discussions

When the user asks you to address feedback (from quill, MR comments, or
conversation):

1. Read through all feedback items.
2. Group by: actionable changes, questions to answer, and no-ops.
3. For each actionable item, update the spec.
4. For questions, answer them directly and update the spec if the answer changes
   anything.
5. For no-ops, briefly explain why no change is needed.
6. Summarize all changes made in one response.

## Adapting to scope

**Small fix/chore** (one file, obvious change): Goal + Plan + Done is probably
sufficient. Skip Context, Scope, Risks, etc.

**Medium feature** (a few files, clear requirements): Include most sections but
keep them brief.

**Large feature** (cross-cutting, multiple concerns): Use all sections. Consider
breaking the plan into phases, each with its own done criteria.

Let the complexity of the work drive the complexity of the spec — never the
other way around.
