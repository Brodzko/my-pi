---
name: archivist
description: Git workflow conventions and safety rules. Use when performing any git operations — committing, branching, rebasing, worktree management. Enforces commit conventions, branch naming, conflict handling, and a no-push policy.
---

# Archivist

Use `git` directly for all operations. No wrapper needed.

## Hard rules

1. **Never push.** No `git push`, no `--force`, no `--set-upstream`. The user handles all pushes manually.
2. **Never force-delete branches** (`git branch -D`) without explicit user approval.
3. **Stop immediately on conflicts.** If any git command produces merge conflicts, stop all work, report the conflicting files, and ask the user how to proceed. Do not attempt to resolve conflicts automatically.
4. **Stop on unexpected git errors.** If a command exits non-zero for any reason other than "nothing to commit" or "already up to date", report the full error output and stop.

## Commit workflow

### When to commit

**Do not commit during work.** Complete the full task first, let the user review the diff, then propose commits.

The flow:

1. Do all work — edit files, run checks, iterate until done.
2. When finished, summarize what changed and why.
3. The user reviews the full diff (`git diff`).
4. Propose a **commit plan** — an ordered list of self-contained commits, each with:
   - A conventional commit message
   - The list of files to include
   - A one-line rationale for why this is a separate commit
5. Wait for the user to approve or adjust the plan.
6. Execute: for each planned commit, stage the files, commit, repeat.

If the user asks you to "just commit everything", make a single commit with an appropriate message.

### Commit plan example

```
Proposed commits (in order):

1. refactor(parser): extract validation into shared helper
   Files: src/lib/validate.ts, src/parser.ts
   Why: Pure refactor, no behavior change

2. feat(parser): add line range validation
   Files: src/parser.ts, src/types.ts
   Why: New feature built on the extracted helper

3. test(parser): add line range validation tests
   Files: src/parser.test.ts
   Why: Tests for the new feature
```

### Pre-commit review offer

When the `code-review` skill is active, offer a diff review after presenting the
commit plan and before executing commits:

> Want to review the diff before I commit?

- If the user accepts, hand off to the code-review pre-commit gate (entry point
  5 in that skill). Only proceed with the commit after all files are approved.
- If the user declines, proceed with the commit immediately.
- If the user says "just commit", skip the offer entirely — same as declining.

This is a lightweight prompt, not an automatic gate. The user opts in per commit.

### Partial staging

When two planned commits both touch the same file, flag it in the plan:

```
⚠️ Commits 1 and 2 both modify src/parser.ts — will need hunk-level staging.
```

Let the user decide whether to adjust commit boundaries or proceed with hunk staging. If proceeding:

1. `git diff <file>` to identify hunks
2. Create a patch with only the relevant hunks
3. `git apply --cached <patch>`
4. Verify with `git diff --cached` before committing

Prefer restructuring commit boundaries to avoid hunk staging when possible.

### Message format

Conventional commits: `type(scope): description`

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `ci`, `build`, `revert`

Scope is optional but preferred. Description is lowercase, imperative mood, no period.

```
feat(parser): add line range validation
fix(auth): handle expired token refresh
refactor: extract shared validation logic
chore(deps): bump zod to 3.24
```

### Amend and fixup

- `git commit --amend` — rewrite the last commit (message and/or content). Confirm with user first.
- `git commit --fixup=<ref>` — create a fixup commit targeting a specific earlier commit. Use when a small correction belongs with a prior commit. The user will squash these during interactive rebase before pushing.

When the user asks to "fix up" a commit, prefer `--fixup=<ref>` over amending unless the target is HEAD.

## Branch conventions

### Naming

```
<type>/<ticket>-<short-description>    # with linked ticket
<type>/<short-description>             # without ticket
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `release`, `hotfix`

Examples:

```
feat/PROJ-123-add-line-validation
fix/PROJ-456-token-refresh-race
refactor/extract-review-parser
chore/bump-dependencies
```

Use lowercase, hyphens between words. When a ticket exists, always include it after the type.

### Creating and switching

```bash
git switch -c feat/PROJ-123-my-feature       # new branch from current HEAD
git switch -c fix/PROJ-456-bug-name main     # new branch from specific ref
git switch feat/existing-branch              # switch to existing
```

Prefer `git switch` over `git checkout` for branch operations.

## Fetch and pull

```bash
git fetch                              # always safe
git pull --rebase                      # preferred over plain pull
```

Both are fine as long as they complete cleanly. If conflicts arise, follow the hard rule: stop and report.

## Rebase

### When rebasing onto a target branch

```bash
git fetch
git rebase origin/main
```

Before suggesting a rebase, tell the user:

- How many commits will be replayed (`git log --oneline HEAD --not origin/main`)
- Whether there are likely conflicts (`git diff --stat origin/main`)

If conflicts occur during rebase, stop and report:

- Which file(s) have conflicts
- Which commit in the rebase sequence caused it
- Suggest: "resolve conflicts, `git add <files>`, then `git rebase --continue`" — but let the user drive

### Interactive rebase

When the user wants to squash fixups or reorder commits:

```bash
git rebase -i origin/main
```

This opens an editor — the user handles interactive rebase manually. Suggest the command and explain what it will do, but don't try to automate the interactive editor.

## Stash

Use `git stash` directly when needed:

```bash
git stash push -m "WIP: description"
git stash pop
git stash list
```

No special rules — stash is low-risk.

## Worktree workflow

Use worktrees **only when the user explicitly requests it**.

### Creating a worktree

```bash
git worktree add .brodzko/worktrees/<branch-short-name> -b <branch-name>
```

Example:

```bash
git worktree add .brodzko/worktrees/feat-parser -b feat/PROJ-123-add-parser
```

Worktrees live under `.brodzko/worktrees/` in the repo root. Ensure this path is gitignored.

After creating, `cd` into the worktree directory to work there.

### Working inside a worktree

All normal git operations work inside a worktree. Commits, staging, branching — everything applies to the worktree's checked-out branch.

The same branch cannot be checked out in two worktrees simultaneously. If you need a branch that's checked out elsewhere, switch that worktree to a different branch first, or create a new branch.

### Cleaning up a worktree

1. Ensure all changes are committed (or stashed/discarded with user approval)
2. `cd` back to the main repo directory
3. `git worktree remove .brodzko/worktrees/<name>`

If the worktree has uncommitted changes, report them and ask the user before using `--force`.

## Read-only operations

Use git directly. No special rules:

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

## Error handling summary

| Situation                       | Action                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| Merge/rebase conflict           | **Stop immediately.** Report conflicting files. Ask user.           |
| Unexpected non-zero exit        | **Stop.** Report full error output.                                 |
| Dirty worktree blocks operation | Report dirty files. Suggest stash or commit. Ask user.              |
| Branch already exists           | Report. Ask if user wants to switch to it or pick a different name. |
| Detached HEAD                   | Report. Suggest creating a branch if work needs to be preserved.    |
