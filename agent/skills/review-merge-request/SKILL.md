---
name: review-merge-request
description: Review a GitLab merge request file by file in Quill. Use when the user wants a substantive MR review with local checkout, review session tracking, and optional GitLab comment synthesis.
---

# Review merge request

Before starting, read:

- `../quill/SKILL.md`
- `../code-review/REVIEWER.md`
- `../code-review/protocols/review-loop.md`
- `../code-review/protocols/file-ordering.md`
- `../code-review/protocols/session-file.md`
- `../code-review/protocols/session-synthesis.md`
- `../code-review/protocols/gitlab-comment-synthesis.md`
- `../gitlab-review-merge-request/SKILL.md`

## Workflow

1. Use `gitlab-review-merge-request` to identify the MR, fetch details, and
   check it out locally.
2. Parse the MR diff into the set of changed files.
3. Build the ordered file list using the file-ordering protocol.
4. Prepare correction-only annotations.
5. Compute the merge base:

```bash
git merge-base HEAD <target-branch>
```

6. Run the review-loop protocol with `diffRef` set to that merge-base SHA.
7. Run session synthesis.
8. If the user wants to post review findings, apply the GitLab comment synthesis
   protocol before any `gl` posting command.

## Scope

This skill owns the local Quill review walk for an MR.

GitLab-specific actions such as discovery, checkout, posting, and approval live
in `gitlab-review-merge-request`.
