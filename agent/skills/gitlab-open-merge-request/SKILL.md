---
name: gitlab-open-merge-request
description: Open or create a GitLab merge request. Use when the user wants to create a draft or ready MR, including title/description drafting, reviewer selection, and final confirmation.
---

# GitLab: open merge request

Before starting, read:

- `../gitlab/common.md`
- `../gitlab/context.md` when reviewer selection matters

This skill owns the **workflow** for opening an MR. The `gl` tool performs the
atomic GitLab operations.

## Defaults

- **Target branch**: always `develop` unless the user explicitly specifies a
  different branch.
- **Assignee**: always include `martin.brodziansky` as assignee on every MR.

## Workflow

1. **Identify the branch.** Determine the current branch and whether it is the
   branch the user wants to open.
2. **Ensure the branch is pushed.** If the branch is not on origin, push it
   before attempting MR creation.
3. **Draft the title.** Use semantic commit format: `type(scope): description`.
   Keep the description concise, imperative, and lowercase.
4. **Draft the description.** Include:
   - **What & why** — for non-trivial changes, stay very concise
   - **How to QA** — for anything non-trivial
   - **Closes {TICKET-ID}** — if there is a Jira ticket
5. **Ask for missing context.** Ask about the Jira ticket and any reviewer
   constraints only if the information cannot be inferred.
6. **Select reviewers.** Use `choose_options` with the roster from
   `../gitlab/context.md`. List the user's own team first, then others.
7. **Confirm the final proposal.** Present the full title + description +
   reviewers + assignee to the user for review/editing. Do not submit without
   approval.
8. **Create the MR.** Call:

```bash
gl mr create --title "type(scope): description" --description "..." --target-branch develop --reviewer user1,user2
```

Then immediately add the assignee:

```bash
gl mr update --iid <IID> --add-assignee martin.brodziansky
```

9. **Respect draft intent.** Add `--draft` if the user wants a draft/WIP MR.
10. **Confirm completion.** Return the MR URL from the command response.

## Post-creation fixes

If a mistake was made in the MR (wrong title, description, target branch, etc.),
use `gl mr update` to fix it instead of recreating:

```bash
gl mr update --iid <IID> --title "new title"
gl mr update --iid <IID> --description "new description"
gl mr update --iid <IID> --target-branch develop
gl mr update --iid <IID> --add-label bug --remove-label feature
gl mr update --iid <IID> --add-reviewer jan.marsicek
gl mr update --iid <IID> --draft    # mark as draft
gl mr update --iid <IID> --no-draft # mark as ready (use --draft false)
```

## Reviewer convention

Follow `../gitlab/context.md`:

- default to one random teammate from the user's team when that convention
  exists
- let the user override whenever reviewer choice is meaningful

## Notes

- Squash and source-branch deletion are already handled by the CLI defaults.
- Use `gl mr create --dry-run` when you need to preview or debug the payload.
- Use this skill only for the multi-step creation workflow. For one-off reads or
  comments, use the relevant `gl` command directly.
