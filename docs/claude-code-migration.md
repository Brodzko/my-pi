# Claude Code Migration Manifest

> Maps every pi concept to its Claude Code equivalent, workaround, or known gap.
> Use this as the runbook when migrating.

## Agent config

| pi concept | Claude Code equivalent | Action |
| --- | --- | --- |
| `~/.pi/agent/AGENTS.md` (global) | `~/.claude/CLAUDE.md` | Copy portable sections (marked with `<!-- PORTABLE -->` comments in current file). Rewrite pi-specific tool bindings per `<!-- PI-SPECIFIC -->` comments. |
| `<repo>/AGENTS.md` (project) | `<repo>/CLAUDE.md` | Same — copy and adapt. |
| `agent/settings.json` | `~/.claude/settings.json` | Different schema. Recreate manually. |

## Memory system

| pi concept | Claude Code equivalent | Action |
| --- | --- | --- |
| `.brodzko/memory/` (project) | `.brodzko/memory/` (unchanged) | No change needed. Protocol is agent-agnostic. See `docs/memory-protocol.md`. |
| `~/.pi/agent/LEARNINGS.md` | `~/.claude/CLAUDE.md` sections | Merge content into global CLAUDE.md or keep as standalone files referenced from it. |
| `~/.pi/agent/ANTI_PATTERNS.md` | Same approach | Merge or reference. |
| `~/.pi/agent/DECISIONS.md` | Same approach | Merge or reference. |
| Memory retrieval instructions | CLAUDE.md instructions | Copy from `docs/memory-protocol.md`. |

## Built-in tools

| pi tool | Claude Code equivalent | Notes |
| --- | --- | --- |
| `Read` | `Read` | Identical. |
| `Write` | `Write` | Identical. |
| `Edit` | `Edit` | Identical. |
| `Bash` | `Bash` | Identical. |
| `Grep` | `Grep` | Identical. |
| `find` | `Glob` | Near-identical (different name). |
| `ls` | `LS` | Identical. |

## Custom tools / extensions

| pi extension | Claude Code equivalent | Effort | Notes |
| --- | --- | --- | --- |
| `get-diagnostics` | VS Code language server (in IDE) or `tsc --noEmit` / `npx eslint` via Bash | 🟢 Low | In VS Code, IDE diagnostics may be available natively. In terminal, fall back to CLI tools. |
| `quill` (review) | MCP server wrapping `quill` CLI | 🟡 Medium | Quill binary is already portable (JSON stdout). Needs an MCP wrapper that spawns quill in a new terminal tab and reads result. See `tools/review-core/` and quill CLI contract. |
| `gl` (GitLab CLI) | MCP server wrapping `gl` CLI | 🟢 Low | `gl` binary is already portable with citty + JSON I/O. Thin MCP wrapper. See `tools/gl-cli/docs/cli-usage.md`. |
| `choose-options` | Free-text conversation | 🟢 Low | No structured picker in CC. Agent presents numbered options in chat, user types a number. Inquisitor skill rubric still useful as prompt guidance. |
| `sessions/*` | Not available | 🔴 N/A | Session lifecycle (handoff, indexing, naming, notifications, references) is pi-internal. Accept loss. |
| `quick-open` | Not available (VS Code has native equivalent) | 🔴 N/A | Pi TUI feature. VS Code users already have Cmd+P. |
| `statusline` | Not available | 🔴 N/A | Pi TUI feature. No equivalent needed in CC. |
| `minimal-tools` | Not applicable | — | Pi-internal. |
| `review` | Via quill MCP or inline diff review | 🟡 Medium | Depends on quill migration. |

## Skills

| pi skill | Claude Code equivalent | Effort | Notes |
| --- | --- | --- | --- |
| `spec-writer` | CLAUDE.md section or custom slash command | 🟢 Low | Pure prompt instructions. Copy to CLAUDE.md. No tool dependencies. |
| `inquisitor` | CLAUDE.md section | 🟢 Low | Decision rubric is useful as prompt guidance even without `choose_options`. Adapt to "present numbered options in chat." |
| `archivist` + git sub-skills | CLAUDE.md sections | 🟡 Medium | Pure prompt instructions but reference `choose_options` and quill. Replace tool references with CC equivalents. Safety rules and conventions are fully portable. |
| `code-review` + review sub-skills | CLAUDE.md sections + quill MCP | 🟡 Medium | Depends on quill migration. If quill not available, degrade to inline diff + conversational feedback. |
| `gitlab` + gitlab sub-skills | CLAUDE.md sections + `gl` MCP or `glab` | 🟡 Medium | Replace `gl` tool references with MCP tool or `glab` CLI calls. |
| `session-query` | Not available | 🔴 N/A | Could build MCP reading `~/.claude/projects/` but session format is undocumented. |

## Skill routing

Pi has router skills that dispatch to sub-skills. Claude Code has no routing
mechanism. Options:

1. **Flatten into CLAUDE.md sections** with clear headers — Claude will
   pattern-match from the full instruction set.
2. **Custom slash commands** (`/review`, `/spec`, `/commit`) — CC supports these
   for common workflows.
3. **MCP tool descriptions** — if tools are exposed via MCP, their descriptions
   serve as implicit routing.

Recommendation: Start with option 1 (flat CLAUDE.md). Add slash commands only if
context window pressure or workflow clarity demands it.

## Tool-binding pattern for portable skills

To keep skill instructions agent-agnostic, use a **tool-binding preamble** at
the top of each skill that maps abstract actions to concrete tools:

```markdown
## Tool bindings

| Action | pi | Claude Code |
| --- | --- | --- |
| check-types | `get_diagnostics` (providers: ["typescript"]) | `tsc --noEmit` via Bash or IDE diagnostics |
| check-lint | `get_diagnostics` (providers: ["eslint"]) | `npx eslint <file>` via Bash or IDE diagnostics |
| present-choices | `choose_options` tool | Numbered list in chat |
| review-file | `quill_review` tool | Show diff + ask feedback in chat (or quill MCP) |
| run-gitlab | `gl` tool | `gl` MCP tool or `glab` CLI via Bash |
```

The skill body uses the abstract action name (e.g. "check types on touched
files"). The binding preamble tells the agent which concrete tool to use.

## Multi-provider model access

Pi supports Anthropic, Bedrock, and OpenAI Codex models via `settings.json`.
Claude Code is Claude-only. No workaround — accept the constraint or use
separate tools for non-Claude models.

## Migration order (recommended)

1. **CLAUDE.md** — port global + project instructions (highest leverage).
2. **Memory system** — already portable, just update retrieval paths.
3. **`gl` MCP server** — thin wrapper around existing portable CLI.
4. **`quill` MCP server** — thin wrapper around existing portable binary.
5. **Skill instructions** — port one at a time, starting with most-used.
6. **Slash commands** — add for high-frequency workflows as needed.
