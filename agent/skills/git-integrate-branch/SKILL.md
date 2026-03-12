---
name: git-integrate-branch
description: Fetch, inspect, or cautiously update branch integration state. Use when the user wants to compare against a target branch, run `git pull --rebase`, or get guidance before doing a manual explicit rebase.
---

# Git: integrate branch

Before starting, read:

- `../archivist/common.md`
- `../archivist/conventions.md`

This skill may inspect integration state freely. It may also attempt
`git pull --rebase`, but it must not run explicit `git rebase` commands.

## Safe fetch

This is usually safe when it completes cleanly:

```bash
git fetch
```

If a fetch fails unexpectedly, stop and follow the shared error policy.

## Inspect integration state

When the user wants to understand whether a branch needs rebasing or what would
happen next:

1. `git fetch`
2. Identify the target branch explicitly.
3. Report useful context such as:
   - how many commits are ahead/behind the target branch
   - which commits would be replayed by a rebase
   - whether the diff suggests likely conflicts
4. Suggest the manual next step the user can run if they choose to do an
   explicit rebase.

## `git pull --rebase`

If the user wants to update the current branch and `git pull --rebase` is the
chosen approach:

```bash
git pull --rebase
```

Rules:

- attempt it only when it matches user intent
- if it succeeds cleanly, report the result
- if it fails or creates conflicts, stop immediately
- report the error/conflicting files and hand control back to the user
- do not continue, resolve conflicts, or run follow-up rebase commands

## Manual explicit rebase guidance only

If the user asks about explicit rebasing:

- explain what command they would run, for example `git rebase origin/main`
- explain likely risks or conflicts
- do **not** run the rebase
- do **not** run interactive rebase on the user's behalf
