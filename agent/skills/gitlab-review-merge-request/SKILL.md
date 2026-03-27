---
name: gitlab-review-merge-request
description: Review a GitLab merge request end to end. Use when the user wants to inspect, check out, comment on, or approve an MR, including handoff into review workflows.
---

# GitLab: review merge request

Before starting, read:

- `../gitlab/common.md`
- `../code-review/protocols/gitlab-comment-synthesis.md` if the task includes
  turning review notes into GitLab comments

This skill covers the GitLab-specific part of MR review. It may hand off into a
separate review workflow skill for the file-by-file review itself.

## Workflow

1. **Identify the MR.** Use the IID provided by the user, or discover candidate
   MRs with:

```bash
gl mr list --reviewer @me --state opened
```

2. **Fetch details.** Read the MR with `--include` specifying only the sections
   you need (prefer this over `--full`):

```bash
gl mr get --iid N --include basics,discussions
gl mr get --iid N --include basics,changes
gl mr get --iid N --include basics,pipeline,approvals
```

3. **Choose the next action.** Depending on user intent:
   - quick inspect → summarize MR basics, changes, pipeline, and discussions
   - local review → continue to checkout
   - comment/approve only → use the direct `gl` command and stop
4. **Check out locally** when deeper code review is required:

```bash
gl mr checkout --iid N
```

5. **Ensure the MR branch tracks its remote and is up to date.**

```bash
git branch --set-upstream-to=origin/<source-branch>
git pull --ff-only
```

   If `--ff-only` fails (local commits diverged), stop and tell the user rather
   than force-pulling or rebasing silently.

6. **Ensure the target branch is up to date** so diffs and merge-base are
   accurate:

```bash
git fetch origin <target-branch>
```

   Do **not** check out the target branch — a fetch is enough. The target branch
   name is available from the MR metadata fetched in step 2.

7. **Hand off to code review** when the task is a substantive file review:
   - use `review-merge-request` for the Quill/session workflow
   - keep this skill focused on GitLab fetch/checkout/posting concerns
8. **After addressing review comments:** Make the code changes, show them to the
   user, and **wait for explicit approval before committing, pushing, or
   replying to threads.** Never auto-commit, auto-push, or auto-reply.
9. **Post comments only after approval.** If review output needs to become GitLab
   comments, follow `../code-review/protocols/gitlab-comment-synthesis.md`.
   Never reply to MR discussions without the user's explicit go-ahead.
10. **Approve only when clean.** Use `gl mr approve --iid N` only after the user
    confirms there are no remaining concerns to post.

## Direct actions

For deterministic follow-up actions, use `gl` directly:

- `gl mr note create --iid N --body "..."`
- `gl mr note create-line --iid N --file path --line 10 --line-type new --body "..."`
- `gl mr discussion reply --iid N --discussion-id abc123 --body "..."`
- `gl mr discussion resolve --iid N --discussion-id abc123`
- `gl mr approve --iid N`

## Scope

This skill owns the GitLab side of MR review:

- discovery
- fetching MR metadata
- local checkout
- posting approved comments
- approval/unapproval

It does **not** own the generic Quill review loop. That belongs to the review
workflow skills.
