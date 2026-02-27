---
name: gitlab
description: GitLab merge request review workflows. Use when working with GitLab MRs — listing, reviewing, commenting, approving, batch reviews. Provides the `gl` tool for structured GitLab operations.
---

# GitLab

Use the `gl` tool for **all** GitLab operations. **Never** call `glab` directly — always go through `gl`.

When asked about someone's work, activity, or what they've been doing — this means their **GitLab activity** (MRs authored/reviewed), not git logs.

## Prerequisites

- `glab` must be installed and authenticated (`glab auth login`)
- Must be in a git repo with a GitLab `origin` remote

## Project & team context

Before assigning reviewers or making team-specific decisions, read:

```
read ./context.md
```

(Relative to this skill directory.)

## Learning the CLI

Before first use, read the full command reference. The file is located at `tools/gl-cli/docs/cli-usage.md` inside the pi config repo (`~/.pi`):

```
read ../../tools/gl-cli/docs/cli-usage.md
```

(Relative to this skill directory.)

This covers all commands, flags, output format, error codes, and jq examples.

## Quick Reference

### Discovery

```
gl mr list --reviewer @me --state opened
gl mr list --author alice --label bug --sort created_desc
```

### Read MR details

```
gl mr get --iid 42 --include basics,changes,discussions,pipeline,approvals
```

Sections: `basics`, `changes`, `discussions`, `pipeline`, `approvals`. Comma-separated.

### Comments

```
gl mr note create --iid 42 --body "LGTM"
gl mr note create --iid 42 --body "LGTM" --unique
gl mr note create-line --iid 42 --file src/x.ts --line 10 --line-type new --body "Nit: rename"
```

### Discussions

```
gl mr discussion reply --iid 42 --discussion-id abc123 --body "Fixed"
gl mr discussion resolve --iid 42 --discussion-id abc123
gl mr discussion unresolve --iid 42 --discussion-id abc123
```

### Approval

```
gl mr approve --iid 42
gl mr unapprove --iid 42
```

### Batch review

```
gl mr review submit --iid 42 --input review.json --dry-run
gl mr review submit --iid 42 --input review.json
```

### Checkout

```
gl mr checkout --iid 42
```

## Output format

All commands return JSON:

```json
{ "ok": true, "data": { ... }, "meta": { ... } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

## Introspection

Every command supports `--schema` to print its input JSON schema:

```
gl mr review submit --schema
```

## Review workflow

1. `gl mr list --reviewer @me --state opened` — find MRs to review
2. `gl mr get --iid N --include basics,changes,discussions` — understand the MR
3. `gl mr checkout --iid N` — check out the code locally for deeper analysis
4. Post comments with `gl mr note create` / `gl mr note create-line`
5. Resolve addressed discussions with `gl mr discussion resolve`
6. `gl mr approve --iid N` when satisfied

For batch operations, construct a `review.json` and use `gl mr review submit`.

## Error handling

- `AUTH_REQUIRED` — remind user to run `glab auth login`
- `LINE_NOT_IN_DIFF` — line number not in MR diff; verify with `gl mr get --include changes`
- `PRECONDITION_FAILED` — strict check failed (draft MR, red pipeline, unresolved discussions)
- `NOT_FOUND` — MR or resource doesn't exist
