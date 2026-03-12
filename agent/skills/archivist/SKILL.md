---
name: archivist
description: Router for git workflows and safety rules. Use for generic git requests, then hand off to the narrowest workflow for commits, branches, integration, or worktrees.
---

# Archivist

Use `git` directly for all operations. This is a **routing skill** plus shared
git safety policy.

Before doing any write-like git operation, read:

- `./common.md` — hard safety rules and operational guardrails
- `./conventions.md` — commit and branch naming conventions

## Routing

Choose the narrowest workflow:

- **Plan or create commits** → use `git-prepare-commit`
- **Create, switch, or inspect branches** → use `git-manage-branches`
- **Fetch, pull, rebase, or otherwise integrate a branch** → use `git-integrate-branch`
- **Create or remove a worktree** → use `git-manage-worktrees`

Use this router only when the user asks for generic git help and the exact
workflow is not yet clear.

## Read-only operations

For safe inspection-only commands, stay here after reading `./common.md`:

```bash
git status
git log --oneline -20
git log --oneline --graph --all -30
git diff
git diff --cached
git diff --stat
git diff main..HEAD
git show <ref>
git blame <file>
git branch -a
git stash list
git worktree list
```
