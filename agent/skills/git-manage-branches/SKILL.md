---
name: git-manage-branches
description: Create, switch, and inspect git branches safely. Use when the user wants to start a branch, switch branches, or ensure the branch base/upstream is correct.
---

# Git: manage branches

Before starting, read:

- `../archivist/common.md`
- `../archivist/conventions.md`

This skill exists because branch management needs a **strict, explicit
protocol**. Never silently assume the base branch or upstream state.

## Creating a new branch

When asked to create or start a branch:

1. Determine the target branch name.
2. Determine the base branch.
   - if the user specified one, use it
   - otherwise default to `develop`
3. Run `git fetch` first.
4. Verify the base ref exists.
5. Create the new branch from the explicit base ref, preferably:

```bash
git switch -c <new-branch> origin/<base>
```

6. Verify the current branch after switching.
7. Establish upstream tracking for the **same branch name**:

```bash
git push -u origin <new-branch>
```

8. Report explicitly:
   - created branch name
   - base ref used
   - whether upstream is configured

## Switching to an existing branch

When asked to switch branches:

1. Check for a dirty worktree first.
2. If the target branch already exists locally, prefer:

```bash
git switch <branch>
```

3. If it exists only remotely, create the local tracking branch explicitly.
4. Verify the current branch after switching.
5. Report the final branch name and upstream status.

## Branch naming

Use the conventions from `../archivist/conventions.md`.
When the user gives only ticket/intent, derive the full branch name before
running any command.

## Important constraints

- Never create from an implicit or guessed base branch without stating it.
- Never push an existing branch.
- Never push to a differently named remote branch.
- Never force push.
- If the branch already exists, stop and ask whether to switch to it or choose a
  different name.
