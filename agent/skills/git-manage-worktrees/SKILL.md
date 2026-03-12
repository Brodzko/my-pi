---
name: git-manage-worktrees
description: Create and remove git worktrees safely. Use when the user explicitly wants parallel branches checked out in separate directories.
---

# Git: manage worktrees

Before starting, read:

- `../archivist/common.md`
- `../archivist/conventions.md`

Use worktrees **only when the user explicitly requests them**.

## Creating a worktree

1. Run `git fetch`.
2. Determine the target branch name.
3. Determine the base branch.
   - if unspecified, default to `develop`
4. Create the worktree under `.brodzko/worktrees/` from the explicit base ref:

```bash
git worktree add .brodzko/worktrees/<branch-short-name> -b <branch-name> origin/<base>
```

5. Ensure `.brodzko/worktrees/` is gitignored.
6. Report the created path, branch name, and base ref.

## Working inside a worktree

All normal git operations still apply inside the worktree.
A branch cannot be checked out in two worktrees at the same time.

## Removing a worktree

1. Ensure changes are committed, stashed, or explicitly approved for discard.
2. Return to the main repo directory.
3. Remove it:

```bash
git worktree remove .brodzko/worktrees/<name>
```

If the worktree has uncommitted changes, stop and ask before using `--force`.
