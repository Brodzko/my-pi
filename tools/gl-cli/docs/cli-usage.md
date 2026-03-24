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

### Create

```bash
# Create MR with title and reviewers (squash + delete branch enabled by default)
gl mr create --title "feat(queue): add batch processing" --reviewer jan.marsicek

# With description and multiple reviewers
gl mr create --title "fix(api): handle timeout" --description "Closes JIRA-123" --reviewer jan.marsicek,jan.pfajfr

# With labels, targeting a specific branch
gl mr create --title "chore(deps): bump vite" --target-branch develop --label dependencies

# Create as draft
gl mr create --title "wip: explore new approach" --draft

# Dry run — see what would be created
gl mr create --title "feat(queue): add batch processing" --reviewer jan.marsicek --dry-run
```

Flags:

- `--title` (required) — MR title
- `--description` — MR body
- `--target-branch` — target branch (default: `master`)
- `--reviewer` — comma-separated reviewer usernames
- `--label` — comma-separated labels
- `--squash` — squash commits on merge (default: `true`)
- `--remove-branch` — delete source branch on merge (default: `true`)
- `--draft` — mark as draft
- `--dry-run` — validate without creating

### Update

```bash
# Update title
gl mr update --iid 42 --title "fix(api): correct timeout handling"

# Update description and target branch
gl mr update --iid 42 --description "Updated description" --target-branch develop

# Add reviewers and assignees
gl mr update --iid 42 --add-reviewer jan.marsicek --add-assignee martin.brodziansky

# Add/remove labels
gl mr update --iid 42 --add-label bug --remove-label feature

# Mark as draft or ready
gl mr update --iid 42 --draft
gl mr update --iid 42 --no-draft

# Dry run
gl mr update --iid 42 --title "new title" --dry-run
```

Flags:

- `--iid` (required) — MR IID to update
- `--title` — new MR title
- `--description` — new MR description body
- `--target-branch` — new target branch
- `--add-reviewer` — comma-separated reviewer usernames to add
- `--remove-reviewer` — comma-separated reviewer usernames to remove (limited glab support)
- `--add-label` — comma-separated labels to add
- `--remove-label` — comma-separated labels to remove
- `--add-assignee` — comma-separated assignee usernames to add
- `--remove-assignee` — comma-separated assignee usernames to remove (limited glab support)
- `--draft` — mark as draft
- `--no-draft` — mark as ready (pass `--draft false`)
- `--squash` — set squash-before-merge
- `--dry-run` — validate without updating

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

# Line comment (SHAs auto-resolved, works on any line visible in the diff — context or changed)
gl mr note create-line --iid 42 --file src/parser.ts --line 84 --line-type new --body "Extract this?"

# Edit an existing note (works for both general notes and discussion notes)
gl mr note edit --iid 42 --note-id 123456 --body "Updated comment text"

# Dry run
gl mr note edit --iid 42 --note-id 123456 --body "Updated" --dry-run
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

### CI Config

```bash
# Print the final merged CI/CD configuration for the current project
gl ci config
```

Returns the fully merged `.gitlab-ci.yml` after all includes are resolved.

### CI Lint

```bash
# Validate the project .gitlab-ci.yml
gl ci lint

# Validate with merged YAML included in response
gl ci lint --dry-run

# Lint arbitrary YAML content
gl ci lint --content "stages: [build, test]\nbuild:\n  script: echo hello"
```

Flags:

- `--content` — raw YAML string to lint instead of the project `.gitlab-ci.yml`
- `--dry-run` — include merged YAML in the response

## Debug

```bash
GL_DEBUG=1 gl mr list --reviewer @me   # Trace glab commands to stderr
gl mr list --verbose                    # Detailed progress to stderr (TBD)
```

## Error Codes

| Code                  | Meaning                      |
| --------------------- | ---------------------------- |
| `AUTH_REQUIRED`       | Run `glab auth login`        |
| `NOT_IN_GIT_REPO`     | Not in a git repo            |
| `NO_GITLAB_REMOTE`    | No GitLab remote on `origin` |
| `NOT_FOUND`           | Resource doesn't exist       |
| `VALIDATION_ERROR`    | Bad args or schema           |
| `LINE_NOT_IN_DIFF`    | Line not in MR diff          |
| `PRECONDITION_FAILED` | Strict check failed          |
| `UPSTREAM_ERROR`      | GitLab API error             |
| `GLAB_ERROR`          | glab subprocess failure      |
| `LOCAL_GIT_ERROR`     | Git operation failed         |
