# Claude Code Migration

> Migrate agent config from pi-only to a harness-agnostic shared setup that works with both pi and Claude Code, using `AGENTS.md` as the canonical name and symlinking to harness-specific locations.

## Context

All agent instructions, skills, memory, and portable tools currently live in `~/.pi/`. The architecture already follows a portability-first philosophy (portable CLI cores + thin pi wrappers + skill instructions), but the config itself is pi-only. We want to try Claude Code without losing the pi setup.

## Goal

A single source of truth for agent config that:

- Uses harness-agnostic names (`AGENTS.md`, not `CLAUDE.md`)
- Symlinks into harness-specific locations (`~/.claude/CLAUDE.md` → shared `AGENTS.md`)
- Keeps pi working as-is during migration
- Lets us evaluate Claude Code with the same instructions, skills, and tools

## Inventory

### Fully portable (copy as-is)

| Asset | Location | Notes |
|---|---|---|
| Global instructions | `agent/AGENTS.md` | Already has `PI-SPECIFIC` markers for easy split |
| `LEARNINGS.md` | `agent/LEARNINGS.md` | Plain markdown |
| `ANTI_PATTERNS.md` | `agent/ANTI_PATTERNS.md` | Plain markdown |
| `DECISIONS.md` | `agent/DECISIONS.md` | Plain markdown |
| `gl-cli` | `tools/gl-cli/` | Standalone CLI, JSON I/O |
| `review-core` | `tools/review-core/` | Standalone CLI |
| Project memory | `.brodzko/memory/*.md` | Per-project, agent-agnostic format |

### Portable skills (pure git/markdown, no pi tools)

| Skill | Files |
|---|---|
| `archivist` | `SKILL.md`, `common.md`, `conventions.md` |
| `git-prepare-commit` | `SKILL.md` |
| `git-manage-branches` | `SKILL.md` |
| `git-integrate-branch` | `SKILL.md` |
| `git-manage-worktrees` | `SKILL.md` |
| `spec-writer` | `SKILL.md` |

### Skills that reference `gl` tool (need adaptation)

| Skill | Files |
|---|---|
| `gitlab` | `SKILL.md`, `common.md`, `context.md` |
| `gitlab-open-merge-request` | `SKILL.md` |
| `gitlab-review-merge-request` | `SKILL.md` |
| `gitlab-activity` | `SKILL.md` |

These say "use the `gl` tool" (pi extension). For Claude Code, `gl-cli` needs to be on PATH and skills need to say "run `gl` via bash" instead.

### Pi-only skills (depend on pi-specific tools)

| Skill | Depends on | Claude Code equivalent |
|---|---|---|
| `quill` | `quill_review` tool | TBD — figure out at the end |
| `code-review` | Quill review loop | TBD |
| `review-agent-work` | Quill | TBD |
| `review-files` | Quill | TBD |
| `review-merge-request` | Quill | TBD |
| `review-pre-commit` | Quill | TBD |
| `inquisitor` | `choose_options` tool | Inline prompts (no special tool needed) |
| `session-query` | pi session system | No equivalent — drop |

### Pi-only (don't migrate)

| Asset | Location |
|---|---|
| Pi extensions | `agent/extensions/*` |
| Pi settings | `agent/settings.json`, `agent/models.json` |
| Pi sessions | `agent/sessions/`, `agent/sessions-meta/` |

## Plan

### Phase 1: Shared config repo + global instructions

1. Create `~/.agent-config/` git repo with structure:
   ```
   ~/.agent-config/
   ├── AGENTS.md              # global instructions (harness-agnostic)
   ├── memory/
   │   ├── LEARNINGS.md
   │   ├── ANTI_PATTERNS.md
   │   └── DECISIONS.md
   ├── skills/                # portable skills (reviewed one by one)
   ├── tools/                 # portable CLIs
   │   ├── gl-cli/
   │   └── review-core/
   └── scripts/
       └── sync.sh            # manages symlinks to ~/.claude/ and ~/.pi/
   ```
2. Extract portable core from `agent/AGENTS.md` — strip `PI-SPECIFIC` comment blocks, produce a clean harness-agnostic `AGENTS.md`.
3. Write `scripts/sync.sh` that:
   - Symlinks `~/.agent-config/AGENTS.md` → `~/.claude/CLAUDE.md`
   - Symlinks memory files to appropriate locations
   - Puts `gl-cli` on PATH (or symlinks the binary)
4. Install Claude Code, run `sync.sh`, test basic interaction.

### Phase 2: Skills migration (one by one)

Go through each skill, decide: **keep / adapt / drop / improve**.

- Pure git skills → copy to `~/.agent-config/skills/`, reference from `AGENTS.md`
- GitLab skills → adapt `gl` tool references to bash invocation
- Quill-based skills → defer to Phase 4
- `inquisitor` → likely drop (Claude Code handles inline prompts)
- `session-query` → drop (no equivalent)

### Phase 3: Project-level config

For work repos (e.g. `elis-frontend`):
- Create `AGENTS.md` in project root with project-specific rules
- Symlink to `.claude/CLAUDE.md` via the project's git hooks or manually

### Phase 4: Quill / review workflows

Figure out what review UX Claude Code offers natively and whether quill skills need a Claude Code equivalent or can be replaced.

## Key differences to expect

| Concern | Pi | Claude Code |
|---|---|---|
| Global config | `~/.pi/agent/AGENTS.md` | `~/.claude/CLAUDE.md` |
| Project config | `AGENTS.md` in repo root | `.claude/CLAUDE.md` in repo root |
| Custom tools | Extensions (JS) | MCP servers or bash |
| Interactive UI | `quill_review`, `choose_options` | Inline prompts, no TUI handoff |
| Skills | `SKILL.md` auto-discovered by pi | Must be referenced in AGENTS.md |
| Diagnostics | `get_diagnostics` tool (cached) | `tsc --noEmit` / `eslint` via bash |
| Session memory | Pi sessions + `query_session` | No cross-session query |

## Open questions

- [ ] Exact `~/.agent-config/` structure — flat or nested by concern?
- [ ] How to handle skill file references (relative paths in skills assume a layout)
- [ ] Whether to keep pi reading from `~/.agent-config/` via symlinks or keep a separate copy
- [ ] MCP server for `gl` vs bash-only approach for Claude Code
- [ ] Per-project AGENTS.md symlink strategy (manual, git hook, sync script)

## Done

- [ ] `~/.agent-config/` repo created with shared instructions
- [ ] `sync.sh` manages symlinks to `~/.claude/` (and optionally `~/.pi/`)
- [ ] Claude Code installed and working with shared AGENTS.md
- [ ] Each skill reviewed and migrated/dropped/deferred
- [ ] `gl-cli` accessible from Claude Code
- [ ] At least one real project tested with Claude Code
- [ ] Quill/review story resolved (Phase 4)
