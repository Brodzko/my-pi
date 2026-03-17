# Archivist common rules

## Core invariants

1. **Use `git` directly.** No wrapper is required.
2. **Never commit without explicit user approval.** The agent must never run
   `git commit` unless the user has approved the specific commit (message +
   files) in the current conversation turn. Proposing a commit plan is not
   approval. The user must explicitly say yes, approve, LGTM, or equivalent.
   When in doubt, ask.
3. **Never push changes** unless the workflow is specifically establishing the
   upstream branch for a **newly created local branch** of the **same name**.
4. **Do not run explicit rebases.** The agent must not execute `git rebase` or
   `git rebase -i`. `git pull --rebase` is allowed as the narrow exception for
   updating branch state, but if it fails or conflicts, stop immediately and
   hand control back to the user.
5. **Never force-delete branches** (`git branch -D`) without explicit user
   approval.
6. **Stop immediately on conflicts.** If any git command produces merge
   conflicts, stop all work, report the conflicting files, and ask the user how
   to proceed.
7. **Stop on unexpected git errors.** If a command exits non-zero for any reason
   other than an explicitly anticipated case like "nothing to commit" or
   "already up to date", report the full error output and stop.

## Dirty-state policy

If a dirty worktree blocks a branch, rebase, or worktree operation:

- report the affected files
- suggest stash or commit as the next step
- ask the user before proceeding

## Branch creation safety

When creating a branch:

- `git fetch` first
- choose the base branch explicitly; if the user did not specify one, default
  to `develop`
- create from the explicit base ref, preferably `origin/<base>`
- after switching, verify the current branch name
- report the branch name, base ref used, and whether upstream is configured

## Upstream policy

For a **newly created** local branch, it is allowed to establish the upstream
branch of the **same name** using a one-time push, for example:

```bash
git push -u origin <new-branch-name>
```

This is the **only** allowed push performed by the agent.

Do **not**:

- push existing branches
- push to a differently named remote branch
- force push
- push after normal commits unless the user explicitly asks and the relevant
  policy is changed

## Conflict handling summary

| Situation                       | Action                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| Merge/rebase conflict           | **Stop immediately.** Report conflicting files. Ask user.           |
| Unexpected non-zero exit        | **Stop.** Report full error output.                                 |
| Dirty worktree blocks operation | Report dirty files. Suggest stash or commit. Ask user.              |
| Branch already exists           | Report. Ask if user wants to switch to it or pick a different name. |
| Detached HEAD                   | Report. Suggest creating a branch if work needs to be preserved.    |
