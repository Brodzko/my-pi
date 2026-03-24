# GitLab common rules

## Core invariants

- Use the `gl` tool for **all** GitLab operations.
- **Never** call `glab` directly.
- When asked about someone's work, activity, or what they have been doing,
  interpret that as **GitLab activity** (MRs authored/reviewed), not local git
  history.

## Prerequisites

- `glab` must be installed and authenticated (`glab auth login`)
- Must be in a git repo with a GitLab `origin` remote

## Team context

When reviewer selection or team-specific decisions matter, read `./context.md`
first.

## CLI reference

Before first use in an unfamiliar flow, read the full `gl` CLI reference:

```
read ../../tools/gl-cli/docs/cli-usage.md
```

That file defines commands, flags, examples, output shape, and `--schema`
usage.

## Output contract

All `gl` commands return JSON on stdout:

```json
{ "ok": true, "data": { ... }, "meta": { ... } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Use the JSON envelope as the source of truth. Human-oriented logs belong on
stderr.

## Error handling

- `AUTH_REQUIRED` — remind the user to run `glab auth login`
- `LINE_NOT_IN_DIFF` — verify the location with `gl mr get --include changes`
- `PRECONDITION_FAILED` — a strict review/approval precondition failed
- `NOT_FOUND` — the MR or requested resource does not exist

## Common commands

### Discovery

```bash
gl mr list --reviewer @me --state opened
gl mr list --author alice --label bug --sort created_desc
```

### Read MR details

```bash
gl mr get --iid 42 --include basics,changes,discussions,pipeline,approvals
```

### Create

```bash
gl mr create --title "feat(scope): description" --description "body" --target-branch develop --reviewer user1,user2
gl mr create --title "fix(api): handle timeout" --reviewer jan.marsicek --dry-run
```

### Update

```bash
gl mr update --iid 42 --title "new title"
gl mr update --iid 42 --description "updated body"
gl mr update --iid 42 --target-branch develop
gl mr update --iid 42 --add-reviewer jan.marsicek --add-label bug
gl mr update --iid 42 --add-assignee martin.brodziansky
gl mr update --iid 42 --draft         # mark as draft
gl mr update --iid 42 --no-draft      # mark as ready
gl mr update --iid 42 --dry-run       # preview without executing
```

### Comments and discussions

```bash
gl mr note create --iid 42 --body "LGTM"
gl mr note create-line --iid 42 --file src/x.ts --line 10 --line-type new --body "Nit: rename"
gl mr note edit --iid 42 --note-id 123456 --body "Updated comment"
gl mr discussion reply --iid 42 --discussion-id abc123 --body "Fixed"
gl mr discussion resolve --iid 42 --discussion-id abc123
```

### Approval

```bash
gl mr approve --iid 42
gl mr unapprove --iid 42
```

### Batch review

```bash
gl mr review submit --iid 42 --input review.json --dry-run
gl mr review submit --iid 42 --input review.json
```
