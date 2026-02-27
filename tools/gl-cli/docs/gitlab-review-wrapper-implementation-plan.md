# GitLab Review CLI (`gl`) — Implementation Plan

## Goal

Build a portable `gl` CLI that enables agent-assisted code review workflows on GitLab with strict JSON contracts and deterministic behavior. Runs in any git repo with a GitLab remote; delegates authentication entirely to `glab`.

**Location**: `tools/gl-cli` in the `.pi` repo. Standalone `package.json` with `bin: { "gl": "./dist/cli.mjs" }`. Install via `npm link` or tarball. No pi SDK dependencies — pure portable CLI.

---

## Decisions (frozen)

| Topic | Decision |
|---|---|
| Project resolution | Auto-detect from git `origin` remote URL. No `--project` flag. Fail if not in a git repo or no GitLab remote found. |
| Authentication | Delegate fully to `glab`. On first API call, verify via `glab auth status`. If not authenticated, error with `AUTH_REQUIRED` and instruct to run `glab auth login`. CLI never handles tokens directly. |
| Provider layer | All GitLab calls go through `glab` subprocess. Use `glab mr ...` for high-level commands and `glab api ...` for raw REST endpoints (discussions, line positions). Always force `--output json` or parse JSON responses. Validate all output with Zod schemas. |
| Output format | JSON to stdout by default. All human-readable logs/errors to stderr. No `--json` flag needed. |
| Config files | None. No `.gl/` directory. Project from git remote, auth from `glab`, no per-repo config. |
| Multi-host | Not needed. Single internal company GitLab instance. `glab` handles host resolution. |
| Exit codes | `0` for success, `1` for any error. Error details in the JSON error envelope. |
| Schema discovery | `--schema` flag on every command. Prints the Zod input schema as JSON and exits. This is the contract — no separate `cli-contract.json`. |
| Line comment positioning | Auto-resolved internally from MR diff versions. Public API exposes only `file`, `line`, `lineType`. SHAs never exposed to callers. If line is not in diff, return `LINE_NOT_IN_DIFF` error with valid line ranges. |
| `mr get` default sections | `--include` defaults to `basics` only. Discussions and changes can be large; agent must explicitly opt in. Skill instructions document which `--include` sets to use per intent. |
| Batch failure handling | Individual action failures don't abort the batch. Response includes both `applied` and `failed` arrays. |
| Duplicate prevention | `--unique` on `mr note create` — lists existing notes, skips if body matches. |
| Idempotency key | Deferred to Phase 2. Reserved in `review.json` schema but not implemented. |

---

## Command Surface (Phase 1)

```
gl mr list
gl mr get
gl mr checkout
gl mr note create
gl mr note create-line
gl mr discussion reply
gl mr discussion resolve
gl mr discussion unresolve
gl mr approve
gl mr unapprove
gl mr review submit
```

11 commands total. No `mr queue mine` (use `gl mr list --reviewer @me --state opened`).

---

## CLI Grammar

All commands accept `--help` and `--schema`. Mutating commands support `--dry-run` where feasible.

```bash
# Discovery
gl mr list [--author <user>] [--assignee <user>] [--reviewer <user|@me>] \
  [--state opened|merged|closed|all] [--draft true|false|any] \
  [--label <name>] [--not-label <name>] \
  [--sort updated_desc|updated_asc|created_desc|created_asc] \
  [--limit <n>] [--page <n>]

# Full review context
gl mr get --iid <number> [--include basics,changes,discussions,pipeline,approvals]  # default: basics only

# Local checkout
gl mr checkout --iid <number> [--branch-name <name>] [--detach]

# General note
gl mr note create --iid <number> --body <text> [--unique] [--dry-run]

# Line-level comment (file + line only; SHAs resolved internally)
gl mr note create-line --iid <number> --file <path> --line <n> \
  --line-type new|old --body <text> [--dry-run]

# Discussion actions
gl mr discussion reply --iid <number> --discussion-id <id> --body <text> [--dry-run]
gl mr discussion resolve --iid <number> --discussion-id <id> [--dry-run]
gl mr discussion unresolve --iid <number> --discussion-id <id> [--dry-run]

# Approval
gl mr approve --iid <number> [--sha <head-sha>] [--dry-run]
gl mr unapprove --iid <number> [--dry-run]

# Batch review submission
gl mr review submit --iid <number> --input <review.json> [--dry-run]
```

---

## CLI Contract Standards

### JSON envelope (stdout only)

Success:
```json
{ "ok": true, "data": { ... }, "meta": { "dryRun": false } }
```

Error:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "MR !42 not found", "details": { ... } } }
```

### Error codes

| Code | When |
|---|---|
| `AUTH_REQUIRED` | `glab auth status` fails — user needs to `glab auth login` |
| `NOT_IN_GIT_REPO` | Not inside a git repository |
| `NO_GITLAB_REMOTE` | No GitLab remote URL found on `origin` |
| `NOT_FOUND` | MR, discussion, or resource doesn't exist |
| `VALIDATION_ERROR` | Invalid CLI args or `review.json` schema violation |
| `LINE_NOT_IN_DIFF` | Specified file+line not in MR diff. `details` includes valid line ranges. |
| `PRECONDITION_FAILED` | Strict checks failed (e.g., unresolved threads when approving) |
| `UPSTREAM_ERROR` | GitLab API returned unexpected error |
| `GLAB_ERROR` | `glab` subprocess failed unexpectedly |
| `LOCAL_GIT_ERROR` | Git operation failed (checkout, remote parsing) |
| `UNKNOWN` | Unclassified error |

### Logging

- All human-readable output (progress, warnings, debug) → stderr
- `--verbose` flag for detailed stderr diagnostics
- `GL_DEBUG=1` env var for raw glab command tracing (stderr, redacted)

---

## Technical Architecture

### Layers

```
┌─────────────────────────────────────┐
│  Command layer (citty)              │  arg parsing, subcommand routing,
│                                     │  --help / --version / --schema
├─────────────────────────────────────┤
│  Validation layer (zod)             │  input schema per command,
│                                     │  output schema per glab response
├─────────────────────────────────────┤
│  Provider layer (glab subprocess)   │  execGlab(args) → JSON → Zod parse
│                                     │  handles: glab mr ..., glab api ...
├─────────────────────────────────────┤
│  Domain layer                       │  normalized MR, Discussion, Note,
│                                     │  Position types (independent of API)
├─────────────────────────────────────┤
│  Output layer                       │  envelope serializer, error formatter
└─────────────────────────────────────┘
```

### Provider layer detail

Single code path: `execGlab(args: string[]) → { stdout: string, stderr: string, exitCode: number }`.

- For high-level commands (`glab mr list`, `glab mr approve`, etc.): pass `--output json`, parse stdout with Zod.
- For raw API calls (`glab api /projects/:id/merge_requests/:iid/discussions`): parse JSON stdout with Zod.
- All glab output is validated through Zod schemas before being transformed into domain types.
- On non-zero exit: parse stderr for error details, map to error codes, return error envelope.

### Project auto-detection

1. Run `git remote get-url origin`
2. Parse URL (SSH or HTTPS) to extract `group/project` (strip `.git` suffix)
3. If no `origin` or URL doesn't match GitLab patterns → `NO_GITLAB_REMOTE` error

### Auth check

1. Run `glab auth status` on first API call (lazy, cached for session)
2. Parse output for authenticated user
3. If fails → `AUTH_REQUIRED` error with message: `"Run 'glab auth login' to authenticate"`

---

## `glab` Command Mapping

### Direct `glab mr` commands

| `gl` command | `glab` command | Notes |
|---|---|---|
| `mr list` | `glab mr list --output json` | Full filter/sort support |
| `mr checkout` | `glab mr checkout` | `--branch` for naming |
| `mr note create` | `glab mr note --output json` | `--message`, `--unique` |
| `mr approve` | `glab mr approve` | `--sha` for safety |
| `mr unapprove` | `glab mr revoke` | |

### Via `glab api` (raw REST)

| `gl` command | GitLab API endpoint | Why not `glab mr`? |
|---|---|---|
| `mr get` (discussions) | `GET /projects/:id/merge_requests/:iid/discussions` | Need full position metadata |
| `mr get` (changes) | `GET /projects/:id/merge_requests/:iid/changes` | Need file-level diff stats |
| `mr get` (approvals) | `GET /projects/:id/merge_requests/:iid/approvals` | Richer than `glab` output |
| `mr note create-line` | `POST /projects/:id/merge_requests/:iid/discussions` | Requires diff position payload |
| `mr discussion reply` | `POST /projects/:id/merge_requests/:iid/discussions/:id/notes` | Not exposed by `glab mr` |
| `mr discussion resolve` | `PUT /projects/:id/merge_requests/:iid/discussions/:id` | Not exposed by `glab mr` |
| `mr get` (diff versions) | `GET /projects/:id/merge_requests/:iid/versions` | Needed to resolve SHAs for line comments |

---

## Line Comment Positioning (internal)

When `gl mr note create-line` is called with `--file`, `--line`, `--line-type`:

1. Fetch MR diff versions via `glab api GET /projects/:id/merge_requests/:iid/versions`
2. Use latest version to get `base_commit_sha`, `start_commit_sha`, `head_commit_sha`
3. Fetch MR changes to get the diff for the specified file
4. Validate that the specified line exists in the diff for the given `lineType` (new/old)
5. If line not in diff → return `LINE_NOT_IN_DIFF` with `details: { file, validRanges: [...] }`
6. Construct full position payload: `{ position_type: "text", base_sha, start_sha, head_sha, old_path, new_path, old_line, new_line }`
7. POST to discussions endpoint

This is entirely internal. The caller never provides or sees SHAs.

---

## `review.json` Contract (v1)

### Schema

```json
{
  "version": 1,
  "iid": 123,
  "strictChecks": {
    "requireGreenPipeline": false,
    "requireNoUnresolvedDiscussions": false,
    "requireNotDraft": false
  },
  "actions": [
    {
      "type": "note",
      "body": "Overall looks solid; left a few nits inline."
    },
    {
      "type": "line_comment",
      "file": "src/review/parser.ts",
      "line": 84,
      "lineType": "new",
      "body": "Can we extract this block into a helper?"
    },
    {
      "type": "reply",
      "discussionId": "abc123",
      "body": "Good catch, addressed in latest commit."
    },
    {
      "type": "resolve",
      "discussionId": "abc123"
    },
    {
      "type": "unresolve",
      "discussionId": "def456"
    }
  ],
  "final": {
    "approve": false,
    "summary": "Addressed all comments except one design question."
  }
}
```

### Validation rules

- `version` required, must be `1`
- `iid` required, must match `--iid` CLI arg if both supplied
- `actions` array required, can be empty if `final.approve === true`
- `line_comment` requires `file`, `line`, `lineType`, `body`
- `reply` requires `discussionId`, `body`
- `resolve`/`unresolve` require `discussionId`
- If `strictChecks` are set and fail, command returns `PRECONDITION_FAILED` before executing any actions
- `final.summary` if provided creates a general note after all actions complete
- `final.approve` triggers approval after all actions and summary

### Execution order

1. Validate schema
2. Run strict checks (if any enabled) — fail fast if violated
3. Execute actions sequentially (order preserved)
4. On per-action failure: record in `failed` array, continue to next
5. Post `final.summary` as general note (if provided)
6. Execute `final.approve` (if true and no `PRECONDITION_FAILED`)
7. Return combined result

### Response shape

```json
{
  "ok": true,
  "data": {
    "applied": [
      { "index": 0, "type": "note", "id": "n1" },
      { "index": 1, "type": "line_comment", "id": "n2" },
      { "index": 2, "type": "reply", "id": "n3" },
      { "index": 3, "type": "resolve", "discussionId": "abc123" }
    ],
    "failed": [
      { "index": 4, "type": "unresolve", "error": { "code": "NOT_FOUND", "message": "Discussion def456 not found" } }
    ],
    "summary": { "posted": true, "id": "n5" },
    "approval": { "attempted": true, "approved": true }
  },
  "meta": {
    "dryRun": false,
    "totalActions": 5,
    "succeeded": 4,
    "failed": 1
  }
}
```

---

## jq Ergonomics (design principle)

All response shapes are designed for minimal-depth `jq` access:

- **Flat triage**: `mr list` includes `pipelineStatus`, `unresolvedDiscussions`, `approvedByMe` — no N+1 `mr get` calls needed.
- **Hoisted position**: discussion `position` is at discussion level, not buried in `notes[0]`. Null for general (non-positioned) discussions.
- **No system notes**: system notes (merge events, label changes, pipeline status changes) are excluded by default. Only human review comments.
- **Single `changeType`**: `"added" | "deleted" | "renamed" | "modified"` instead of three booleans.
- **Stable arrays**: `data` is always the expected shape (array for list, object for get). Never switches types.

Every response is `jq '.data'`-accessible. Agents should never need more than 2 levels of `jq` selection for common tasks.

---

## Response Shape Examples

### `gl mr list`

Includes lightweight triage fields (`pipelineStatus`, `unresolvedDiscussions`, `approvedByMe`) so agents can prioritize without N+1 `mr get` calls.

```bash
# Common agent jq patterns:
gl mr list --reviewer @me --state opened | jq '.data[] | select(.unresolvedDiscussions > 0)'
gl mr list --reviewer @me --state opened | jq '.data[] | select(.approvedByMe == false)'
gl mr list --author alice | jq '.data[] | { iid, title, pipelineStatus }'
```

```json
{
  "ok": true,
  "data": [
    {
      "iid": 123,
      "title": "feat: improve review parser",
      "author": "alice",
      "reviewers": ["bob"],
      "assignees": ["charlie"],
      "draft": false,
      "state": "opened",
      "sourceBranch": "feat/review-parser",
      "targetBranch": "main",
      "labels": ["review-needed"],
      "webUrl": "https://gitlab.example/group/project/-/merge_requests/123",
      "createdAt": "2026-02-25T10:00:00Z",
      "updatedAt": "2026-02-27T12:00:00Z",
      "pipelineStatus": "success",
      "unresolvedDiscussions": 2,
      "approvedByMe": false
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "perPage": 20
  }
}
```

### `gl mr get --iid 123 --include basics,changes,discussions,pipeline,approvals`

Design principles for jq ergonomics:
- **`changes`**: single `changeType` enum instead of 3 booleans (`newFile`/`renamedFile`/`deletedFile`)
- **`discussions`**: `position` hoisted to discussion level (from first positioned note). System notes excluded by default.
- **All sections**: flat enough for single-level `jq` selects

```bash
# Common agent jq patterns:
gl mr get --iid 123 --include discussions | jq '.data.discussions[] | select(.resolved == false) | { id, position }'
gl mr get --iid 123 --include changes | jq '.data.changes[] | select(.changeType == "added") | .newPath'
gl mr get --iid 123 --include discussions | jq '.data.discussions[] | select(.resolved == false) | { id, file: .position.file, thread: [.notes[].body] }'
```

```json
{
  "ok": true,
  "data": {
    "basics": {
      "iid": 123,
      "title": "feat: improve review parser",
      "description": "Refactors the review parser for clarity...",
      "author": "alice",
      "reviewers": ["bob"],
      "assignees": ["charlie"],
      "draft": false,
      "state": "opened",
      "sourceBranch": "feat/review-parser",
      "targetBranch": "main",
      "labels": ["review-needed"],
      "webUrl": "https://gitlab.example/group/project/-/merge_requests/123",
      "createdAt": "2026-02-25T10:00:00Z",
      "updatedAt": "2026-02-27T12:00:00Z",
      "mergeStatus": "can_be_merged"
    },
    "changes": [
      {
        "oldPath": "src/parser.ts",
        "newPath": "src/parser.ts",
        "changeType": "modified",
        "additions": 42,
        "deletions": 18
      }
    ],
    "discussions": [
      {
        "id": "disc_abc123",
        "resolved": false,
        "position": {
          "file": "src/parser.ts",
          "newLine": 84,
          "oldLine": null,
          "lineType": "new"
        },
        "notes": [
          {
            "id": "note_1",
            "author": "bob",
            "body": "Should this be extracted into a utility?",
            "createdAt": "2026-02-26T14:00:00Z"
          },
          {
            "id": "note_2",
            "author": "alice",
            "body": "Good point, will refactor.",
            "createdAt": "2026-02-26T15:00:00Z"
          }
        ]
      }
    ],
    "pipeline": {
      "id": 456,
      "status": "success",
      "webUrl": "https://gitlab.example/group/project/-/pipelines/456"
    },
    "approvals": {
      "approved": false,
      "approvalsRequired": 1,
      "approvalsLeft": 1,
      "approvedBy": []
    }
  }
}
```

---

## Implementation Milestones

### Milestone 0 — Scaffold

- Create `tools/gl-cli/package.json` with `bin: { "gl": "./dist/cli.mjs" }`
- Set up TypeScript, build tooling (tsup or unbuild)
- Citty root command with `--help`, `--version`
- `gl mr` subcommand group
- `--schema` flag infrastructure (serialize Zod schema to JSON)
- Shared utilities: `execGlab()`, `detectProject()`, `checkAuth()`, JSON envelope helpers, error code constants
- Domain types: MR, Discussion, Note, Position (Zod schemas + inferred types)

### Milestone 1 — Read-only commands

- `gl mr list` with all filters/sorting/pagination
- `gl mr get` with `--include` sections (basics, changes, discussions, pipeline, approvals)
- Fixture-based tests for Zod schema validation and glab output normalization

### Milestone 2 — Write commands

- `gl mr note create` with `--unique` (dedup by listing existing notes)
- `gl mr note create-line` with internal SHA resolution and line-in-diff validation
- `gl mr discussion reply`
- `gl mr discussion resolve` / `unresolve`
- `gl mr approve` / `unapprove`
- `--dry-run` on all mutating commands

### Milestone 3 — Batch review orchestration

- `gl mr review submit` with `review.json` v1 parsing
- Sequential action execution with partial failure handling
- Strict checks (pipeline, unresolved discussions, draft status)
- `--dry-run` mode (validates schema + checks, reports what would happen)

### Milestone 4 — Checkout

- `gl mr checkout` with `--branch-name` and `--detach`
- Branch collision handling

### Milestone 5 — Polish & distribution

- `--schema` on every command verified
- `npm link` tested
- `npm pack` → tarball install tested
- Error message quality pass
- `docs/cli-usage.md` quickstart for agents/humans

---

## Testing Strategy

### Unit tests
- Zod schema validation (valid + invalid inputs)
- Git remote URL parsing (SSH, HTTPS, various formats)
- glab output normalization to domain types
- Error code mapping
- `review.json` validation and execution plan generation

### Integration tests (mocked glab)
- Mock `execGlab` to return fixture JSON
- Test full command flows: list → get → note → approve
- Line comment positioning validation against fixture diffs
- Batch review with mixed success/failure actions

### Smoke tests (optional, real GitLab)
- Gated by `GL_SMOKE_TEST=1` env var
- Run against a sandbox project
- Read-only tests only by default; write tests behind additional flag

---

## Observability

- `--verbose` → detailed progress to stderr (which glab commands run, timing)
- `GL_DEBUG=1` → raw glab command + stdout/stderr tracing to stderr (tokens redacted)
- Error envelopes always include `code` + `message` for grep-friendly diagnostics

---

## Out of Scope (Phase 1)

- Auto reviewer assignment
- MR creation/opening from branch
- Cross-project analytics
- Multi-host / multi-GitLab-instance support
- Per-repo config files
- `idempotencyKey` in `review.json` (reserved in schema, not implemented)
- Human-readable output mode (`--human` / `--pretty`)

---

## What This Enables for Agent Skills

With this surface, a skill can reliably execute:

```
"show me my review queue"         → gl mr list --reviewer @me --state opened
"summarize MR and threads"        → gl mr get --iid 42 --include basics,changes,discussions
"reply to this thread"            → gl mr discussion reply --iid 42 --discussion-id abc --body "..."
"resolve this discussion"         → gl mr discussion resolve --iid 42 --discussion-id abc
"leave line comment"              → gl mr note create-line --iid 42 --file src/x.ts --line 84 --line-type new --body "..."
"approve when checks pass"        → gl mr approve --iid 42
"submit full review"              → gl mr review submit --iid 42 --input review.json
```

No GitLab API knowledge required in prompts. Deterministic JSON in, deterministic JSON out.
