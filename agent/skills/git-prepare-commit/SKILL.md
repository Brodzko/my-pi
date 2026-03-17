---
name: git-prepare-commit
description: Plan and create git commits safely. Use when the user wants to commit current work, split changes into atomic commits, amend, or create fixup commits.
---

# Git: prepare commit

Before starting, read:

- `../archivist/common.md`
- `../archivist/conventions.md`

## Hard gate

**Never run `git commit` without explicit user approval.** This is non-negotiable.

- Proposing a commit plan does not count as approval.
- Suggesting a checkpoint does not count as approval.
- The user must explicitly confirm (yes / approve / LGTM / "commit it" / equivalent) before any `git commit` is executed.
- If the user says "commit when done" or similar blanket approval, treat it as approval for the specific plan you present — still present the plan first.
- Use `choose_options` for the approval gate when practical.

## Workflow

### Checkpoint suggestions

Prefer **incremental commits during work** over one big commit at the end.
Proactively suggest a checkpoint when a coherent unit of work is complete.

Good checkpoint signals:

- a pure refactor is done before new behavior is added
- a new module/file is complete and verified
- tests are green after a meaningful change
- a dependency upgrade is verified before consumer changes
- the work is moving from one logical concern to another

Do not over-suggest. One checkpoint per logical boundary is enough.

When suggesting a checkpoint, provide:

- staged or target files
- proposed commit message
- one-line rationale

### End-of-task commit plan

When the task is complete or the user asks to commit:

1. Summarize what changed and why.
2. Propose an ordered commit plan.
3. For each commit include:
   - conventional commit message
   - files to include
   - one-line rationale
4. Wait for the user to approve or adjust the plan.
5. Execute each planned commit in order.

If the user says to commit everything together, make a single coherent commit.

## Pre-commit review

When the review workflow is available, offer:

> Want to review the diff before I commit?

- if accepted, hand off to `review-pre-commit`
- proceed only after the review gate is approved or the user says to commit
  anyway
- if the user says "just commit", skip the review offer

## Partial staging

If two planned commits both touch the same file:

- call that out explicitly
- prefer adjusting boundaries over hunk staging
- if hunk staging is necessary:
  1. inspect the hunks
  2. create/apply a patch for the intended staged portion
  3. verify with `git diff --cached` before committing

## Amend and fixup

- `git commit --amend` — confirm with the user first
- `git commit --fixup=<ref>` — prefer this when a small correction belongs to an
  earlier non-HEAD commit

When the user asks to fix up a prior commit, prefer `--fixup=<ref>` over amend
unless the target is `HEAD`.
