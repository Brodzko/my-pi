# `gl` CLI — Quick Start

Portable GitLab review CLI for agent-assisted code review workflows.

## Prerequisites

- **Node.js** ≥ 20
- **[glab](https://gitlab.com/gitlab-org/cli)** installed and authenticated (`glab auth login`)
- Must be run inside a **git repo** with a GitLab `origin` remote

## Installation

```bash
# From the repo (development)
cd tools/gl-cli && npm install && npm run build && npm link

# From tarball
cd tools/gl-cli && npm pack
npm install -g pi-gl-cli-0.1.0.tgz
```

## Auth

`gl` delegates all authentication to `glab`. If not authenticated:

```
{ "ok": false, "error": { "code": "AUTH_REQUIRED", "message": "..." } }
```

Fix: `glab auth login`

## Commands

### Discovery

```bash
# List open MRs assigned for review
gl mr list --reviewer @me --state opened

# List with filters
gl mr list --author alice --label review-needed --sort created_desc --limit 10
```

### Context

```bash
# Basic MR info (default)
gl mr get --iid 42

# Full review context
gl mr get --iid 42 --include basics,changes,discussions,pipeline,approvals

# Only discussions
gl mr get --iid 42 --include discussions
```

### Comments

```bash
# General note
gl mr note create --iid 42 --body "Overall LGTM"

# Deduplicated note (skip if identical body exists)
gl mr note create --iid 42 --body "LGTM" --unique

# Line comment (SHAs auto-resolved)
gl mr note create-line --iid 42 --file src/parser.ts --line 84 --line-type new --body "Extract this?"
```

### Discussions

```bash
# Reply
gl mr discussion reply --iid 42 --discussion-id abc123 --body "Fixed in latest push"

# Resolve/unresolve
gl mr discussion resolve --iid 42 --discussion-id abc123
gl mr discussion unresolve --iid 42 --discussion-id abc123
```

### Approval

```bash
gl mr approve --iid 42
gl mr unapprove --iid 42
```

### Batch Review

```bash
# Validate without executing
gl mr review submit --iid 42 --input review.json --dry-run

# Execute
gl mr review submit --iid 42 --input review.json
```

### Checkout

```bash
gl mr checkout --iid 42
gl mr checkout --iid 42 --branch-name review/42
gl mr checkout --iid 42 --detach
```

## Output Format

All output is JSON to stdout. Errors to stderr.

```json
{ "ok": true, "data": { ... }, "meta": { ... } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

## Introspection

Every command supports `--schema` to print its JSON Schema:

```bash
gl mr list --schema
gl mr review submit --schema
```

## jq Examples

```bash
# MRs needing review
gl mr list --reviewer @me | jq '.data[] | select(.approvedByMe == false) | { iid, title }'

# Unresolved discussions
gl mr get --iid 42 --include discussions | jq '.data.discussions[] | select(.resolved == false) | .id'

# Added files
gl mr get --iid 42 --include changes | jq '.data.changes[] | select(.changeType == "added") | .newPath'
```

## Debug

```bash
GL_DEBUG=1 gl mr list --reviewer @me   # Trace glab commands to stderr
gl mr list --verbose                    # Detailed progress to stderr (TBD)
```

## Error Codes

| Code | Meaning |
|---|---|
| `AUTH_REQUIRED` | Run `glab auth login` |
| `NOT_IN_GIT_REPO` | Not in a git repo |
| `NO_GITLAB_REMOTE` | No GitLab remote on `origin` |
| `NOT_FOUND` | Resource doesn't exist |
| `VALIDATION_ERROR` | Bad args or schema |
| `LINE_NOT_IN_DIFF` | Line not in MR diff |
| `PRECONDITION_FAILED` | Strict check failed |
| `UPSTREAM_ERROR` | GitLab API error |
| `GLAB_ERROR` | glab subprocess failure |
| `LOCAL_GIT_ERROR` | Git operation failed |
