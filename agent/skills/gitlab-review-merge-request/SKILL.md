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

2. **Fetch details.** Read the MR with:

```bash
gl mr get --iid N --include basics,changes,discussions,pipeline,approvals
```

3. **Choose the next action.** Depending on user intent:
   - quick inspect → summarize MR basics, changes, pipeline, and discussions
   - local review → continue to checkout
   - comment/approve only → use the direct `gl` command and stop
4. **Check out locally** when deeper code review is required:

```bash
gl mr checkout --iid N
```

5. **Verify tracking.** If checkout did not configure upstream tracking, run:

```bash
git branch --set-upstream-to=origin/<branch-name>
```

6. **Hand off to code review** when the task is a substantive file review:
   - use `review-merge-request` for the Quill/session workflow
   - keep this skill focused on GitLab fetch/checkout/posting concerns
7. **Post comments only after approval.** If review output needs to become GitLab
   comments, follow `../code-review/protocols/gitlab-comment-synthesis.md`.
8. **Approve only when clean.** Use `gl mr approve --iid N` only after the user
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
