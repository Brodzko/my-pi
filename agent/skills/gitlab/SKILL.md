---
name: gitlab
description: Router for GitLab workflows. Use for generic GitLab requests, then hand off to a more specific GitLab workflow skill such as opening an MR, reviewing an MR, or inspecting GitLab activity.
---

# GitLab

This is a **routing skill**, not the full workflow playbook.

Use the `gl` tool for **all** GitLab operations. **Never** call `glab` directly —
always go through `gl`. If there is no way to achieve your goals with `gl`, stop and explain to
the user why - they can add the functionality.

Before doing any GitLab work, read:

- `./common.md` — shared invariants, prerequisites, CLI contract, and errors
- `./context.md` — team/reviewer context when reviewer selection or team-specific decisions matter

## Routing

Pick the narrowest matching workflow:

- **Open or create a merge request** → use `gitlab-open-merge-request`
- **Review a merge request** → use `gitlab-review-merge-request`
- **Understand someone's work/activity** → use `gitlab-activity`

If the user asks for a one-off GitLab action that does not justify a whole
workflow (for example: add one comment, approve one MR, resolve one thread),
stay in this skill, read `./common.md`, and call the relevant `gl` command
directly.

## One-off operations

Use direct `gl` commands for simple deterministic actions:

- `gl mr get --iid N --include basics,changes,discussions,pipeline,approvals`
- `gl mr note create --iid N --body "..."`
- `gl mr note create-line --iid N --file path --line 10 --line-type new --body "..."`
- `gl mr note edit --iid N --note-id ID --body "updated text"`
- `gl mr discussion reply --iid N --discussion-id abc123 --body "..."`
- `gl mr discussion resolve --iid N --discussion-id abc123`
- `gl mr update --iid N --title "..." --description "..." --target-branch develop`
- `gl mr update --iid N --add-reviewer user1 --add-assignee user2 --add-label label`
- `gl mr approve --iid N`
- `gl mr unapprove --iid N`

Use workflows when the task needs sequencing, policy, or user decisions.
