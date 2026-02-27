# @pi/gl-cli

Portable GitLab review CLI for agent-assisted code review workflows.

## What

A deterministic CLI (`gl`) that wraps `glab` to provide strict JSON contracts for GitLab merge request operations. Designed for agents but usable by humans.

## Why

- **Deterministic**: JSON in, JSON out. No parsing human-readable output.
- **Portable**: No pi SDK dependency. Works anywhere Node.js and glab are available.
- **Safe**: Auth delegated to glab. Line-position SHAs auto-resolved. Batch failures don't abort.
- **Discoverable**: `--help`, `--version`, `--schema` on every command.

## Requirements

- Node.js ≥ 20
- [glab](https://gitlab.com/gitlab-org/cli) installed and authenticated
- Git repo with a GitLab `origin` remote

## Quick Start

```bash
npm install && npm run build && npm link

gl mr list --reviewer @me --state opened
gl mr get --iid 42 --include basics,discussions
gl mr note create-line --iid 42 --file src/x.ts --line 10 --line-type new --body "Nit: rename?"
gl mr review submit --iid 42 --input review.json
```

## Command Surface

```
gl mr list          — List/filter merge requests
gl mr get           — Fetch MR details (basics, changes, discussions, pipeline, approvals)
gl mr checkout      — Checkout MR branch locally
gl mr note create   — Post a general comment
gl mr note create-line — Post a line-level comment on a diff
gl mr discussion reply — Reply to a discussion thread
gl mr discussion resolve — Resolve a discussion
gl mr discussion unresolve — Unresolve a discussion
gl mr approve       — Approve an MR
gl mr unapprove     — Revoke approval
gl mr review submit — Execute a batch review from review.json
```

## Documentation

- [CLI Usage Guide](docs/cli-usage.md) — full command reference with examples
- [Implementation Plan](docs/gitlab-review-wrapper-implementation-plan.md) — architecture and decisions

## Development

```bash
npm install
npm run build     # Build with tsup
npm run dev       # Watch mode
npm run tsc       # Type check
npm test          # Run tests
npm run format    # Prettier
npm run lint      # ESLint
```

## Migration to Other Agents

This CLI is a standalone binary with a stable JSON contract. To use from Claude Code, Cursor, or any other agent:

1. Install: `npm install -g @pi/gl-cli` (or `npm link` from repo)
2. Use the `gl` binary directly — no pi SDK needed
3. Parse JSON stdout for structured data
4. Use `--schema` to discover input contracts programmatically
