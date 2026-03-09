---
name: code-review
description: Orchestrates code review workflows using Quill. Use whenever the user wants to review code — agent work, arbitrary files, diffs, MRs, or pre-commit gates. Handles file ordering, session management, the review loop, and synthesis.
---

# Code Review

This skill orchestrates all code review workflows. It uses the `quill` skill
(tool reference) for the actual file-by-file review UI, and integrates with
`archivist` (commits) and `gitlab` (MRs) as needed.

**Read the `quill` skill before using this one** — it defines the tool contract,
annotation schema, and output format. This skill defines _when_ and _why_ to use
it, not _how_.

## Entry points

All entry points feed into the same review loop (§ Review Loop below). They
differ only in what files are selected, what diff mode is used, and what
annotations are pre-loaded.

### 1. Review agent work

**Trigger:** User says "show me what you did", "review your changes", or similar
after an agent turn.

1. Run `git diff --name-only` (unstaged) and/or `git diff --cached --name-only`
   (staged) to identify changed files.
2. Build file list using dependency ordering (§ File Ordering).
3. For each file, prepare lightweight change-summary annotations (what changed
   and why, based on your knowledge of the work you just did).
4. Enter the review loop with `unstaged: true` (or `staged: true` if changes are
   staged).

### 2. Full code review

**Trigger:** User points at specific files, a directory, or a feature area and
asks for a review.

1. Identify the target files. If a directory, find all relevant source files.
2. Analyze the code and prepare substantive review annotations — bugs, design
   concerns, style issues, questions, praise for good patterns.
3. Build file list using dependency ordering (§ File Ordering).
4. Enter the review loop (no diff mode — raw file view unless user specifies a
   ref).

### 3. Ad-hoc file inspection

**Trigger:** User wants to look at a single specific file, ask about it, or give
inline instructions.

1. Open the file in Quill. Optionally pre-load annotations if you have relevant
   observations.
2. **Skip the full review loop** — this is a single-file interaction. Process the
   output directly (answer questions, make changes, acknowledge feedback).
3. No session file overhead for single-file inspections unless the user asks to
   continue reviewing more files.

### 4. MR review

**Trigger:** User asks to review a merge request.

1. Use the `gitlab` skill to fetch MR details:
   `gl mr get --iid N --include basics,changes,discussions`
2. Check out the MR locally: `gl mr checkout --iid N`
3. Parse the MR diff into the set of changed files.
4. Analyze the changes and prepare review annotations.
5. Build file list using dependency ordering (§ File Ordering).
6. Enter the review loop with `diffRef` set to the MR target branch (e.g.
   `main`).
7. After synthesis (§ Session Synthesis), offer to post findings to GitLab using
   `gl mr review submit` or `gl mr note create-line`.

### 5. Pre-commit gate

**Trigger:** The `archivist` skill is about to commit, and this skill is active.

1. Archivist composes the commit plan (message, staged files, rationale).
2. Before executing `git commit`, hand off to this skill.
3. **First file in the walk** is a virtual "commit summary" — present the commit
   message, file list, and rationale as annotations for the user to
   approve/deny/edit.
4. Then walk the staged files with `staged: true` diffs.
5. **Approve all** → archivist proceeds with the commit.
6. **Deny on any file** → iterate on feedback, then re-review that file.
7. **Abort** → commit is cancelled. Report what was reviewed.

### 6. Diff against ref

**Trigger:** User asks to see changes vs a branch, tag, or commit (not an MR).

1. Run `git diff --name-only <ref>` to get changed files.
2. Build file list using dependency ordering (§ File Ordering).
3. Prepare change-summary annotations.
4. Enter the review loop with `diffRef: "<ref>"`.

### 7. Re-review

**Trigger:** After a review session where some files were denied, the user asks
to re-review or you offer to re-review after making fixes.

1. Load the existing session file.
2. Filter to files that were denied or have unresolved annotations.
3. Re-open only those files, carrying over unresolved annotations (with any new
   agent replies or status updates).
4. Enter the review loop. The session file is updated in place.

## File Ordering

When reviewing multiple files, order them so the user sees the most important
context first.

**Strategy: topological DFS from the core change outward.**

1. Identify the "core" change — the file(s) that represent the primary intent of
   the work (new feature, bug fix, refactored module).
2. Build a dependency graph of the changed files (imports, type references,
   re-exports).
3. Topologically sort with the core change first.
4. DFS traversal: after reviewing a core file, drill into its dependents and
   dependencies among the changed set.
5. Files with no dependency relationship to others go last.

**Heuristics for identifying the core:**

- New files that introduce the main abstraction
- Files with the most lines changed
- Files whose names match the feature/ticket description
- Source files before test files (tests review last unless the user asks
  otherwise)

If the graph is ambiguous, state your ordering rationale briefly before starting
the walk so the user can adjust.

## Review Loop

The main protocol. All entry points converge here.

```
initialize session file
compute ordered file list

present overview:
  show file list with ordering rationale, entry point context, and any
  high-level observations about the changeset
  then ask the user to confirm before starting the walk:
    use choose_options with "Start review?" → yes / no
    if no → end walk, go to synthesis with nothing reviewed
    if yes → proceed to file walk

for each file in list:
  open in quill (with annotations, diff mode as appropriate)
  read quill output → decision + annotations

  if APPROVE:
    record annotations in session (including any instruct/question annotations),
    continue to next file — approve means "I'm done with this file, move on"

  if DENY:
    pause the walk
    read annotations — answer questions, make fixes, discuss
    when resolved: re-open same file for confirmation
      if user approves on re-open → record, continue
      if user denies again → iterate until resolved or user says "move on"
      if user aborts → end walk

  if ABORT (Ctrl+C / null result):
    end the walk immediately

run session synthesis (§ Session Synthesis)
```

### Deny semantics

Deny means "I have feedback on this file, let's talk before moving on." It is
**not** a failure — it is a conversation trigger.

When a file is denied:

1. Read all annotations carefully. Pay attention to `source: "user"`
   annotations and replies on your annotations.
2. **Process everything in the TUI conversation first:**
   - For `question` annotations: output the highlighted code snippet, the
     question, and your answer — all inline in the TUI. This may spark
     follow-up discussion.
   - For `instruct` annotations: execute the requested code changes.
   - For `comment` annotations: acknowledge and incorporate.
3. Once all discussion and changes are done, prepare updated annotations (new
   observations on changed code, carried-over unresolved items).
4. Re-open the file in Quill with the updated annotations so the user can
   verify.
5. Provide stable `id` values for round-trip continuity.

**Important:** do not try to answer questions or have discussions inside Quill
via annotation replies. All conversation happens in the TUI between Quill
sessions.

### Abort semantics

Abort means "stop reviewing, I'm done." Do not re-open any more files. Go
directly to session synthesis with whatever has been accumulated.

## Session File

Every multi-file review creates a session file that accumulates state across the
walk.

**Location:** `/tmp/pi-review-sessions/<timestamp>-<short-description>.json`

**Structure:**

```json
{
  "startedAt": "ISO timestamp",
  "entryPoint": "agent-work | full-review | mr-review | pre-commit | diff-ref | re-review",
  "diffRef": "main",
  "files": [
    {
      "path": "src/parser.ts",
      "order": 1,
      "decision": "approve",
      "annotations": [ ... ]
    },
    {
      "path": "src/validate.ts",
      "order": 2,
      "decision": "deny",
      "annotations": [ ... ]
    },
    {
      "path": "src/types.ts",
      "order": 3,
      "decision": null,
      "annotations": []
    }
  ],
  "aborted": false,
  "synthesis": null
}
```

- `decision: null` means the file was not yet reviewed (walk was aborted before
  reaching it).
- The session file persists until explicitly deleted. Reference it for re-reviews
  or follow-ups.
- Single-file ad-hoc inspections (entry point 3) do **not** create a session
  file unless the user continues to more files.

## Session Synthesis

After the walk completes (all files reviewed or aborted), consume the full
session and produce:

1. **Summary table:** Each file, its decision, and count of annotations by
   source/intent.
2. **Cross-cutting patterns:** Same issue appearing in multiple files,
   architectural concerns that span the changeset, recurring style issues.
3. **Unresolved items:** Files that were denied and not re-approved, files not
   reviewed due to abort, annotations with open questions.
4. **Proposed actions:** Concrete next steps — fixes to make, follow-ups to
   track, files to revisit.
5. **For pre-commit:** Explicit go/no-go recommendation.
6. **For MR review:** Synthesize final GitLab comments and present for approval
   (see § GitLab integration below). Do not post anything without explicit
   approval.

Present the synthesis as a structured text summary. Ask the user what to act on.

## Integration with other skills

### Archivist

When both `code-review` and `archivist` skills are active:

- Before committing, archivist triggers the pre-commit gate (entry point 5).
- The commit only proceeds after the review loop completes with all files
  approved (or the user explicitly says "commit anyway").
- If the user denies and requests changes during pre-commit review, make the
  changes, then offer to re-enter the pre-commit gate.

### GitLab

When both `code-review` and `gitlab` skills are active:

- MR review (entry point 4) is available.
- After the review walk and session synthesis, **do not push annotations
  directly to GitLab.** Instead, synthesize final review comments and present
  them for approval before posting.

#### Synthesizing GitLab comments

Raw annotations and TUI conversations are working notes — they are not
ready to post as-is. After synthesis, produce a **final comment proposal**:

1. For each comment, synthesize a clear, actionable comment based on the
   annotations _and_ any TUI discussion that happened during the review.
   A single GitLab comment may combine multiple related annotations,
   incorporate context from conversation, or refine wording.
2. Present the full proposal inline in the TUI as a numbered list:

```
GitLab comments to post on !42:

1. src/parser.ts:25
   > Consider extracting the validation logic into a shared helper —
   > this pattern is duplicated in three files (parser.ts, loader.ts,
   > validator.ts). Would reduce the surface for bugs when the schema
   > changes.

2. src/auth.ts:112-118
   > The token refresh races with concurrent requests. If two calls
   > hit an expired token simultaneously, both will attempt refresh.
   > Consider a mutex or deduplication of the refresh call.

3. General (MR-level note)
   > Clean implementation overall. Two concerns flagged inline —
   > the validation duplication and the token refresh race. The rest
   > looks good.
```

3. Wait for the user to approve, edit, or reject the proposal.
4. **Only after explicit approval**, post the comments to GitLab:
   - Line-level comments via `gl mr note create-line`
   - General comments via `gl mr note create`
   - Post the exact text that was approved — do not rephrase after approval
5. If the review is clean (no comments to post), offer to approve the MR
   with `gl mr approve`.

## Reviewer Preferences

Learned reviewer preferences are stored in `REVIEWER.md` (co-located with this
skill file). This system captures review patterns over time and uses them to
provide better, more personalized reviews.

### Before every review session

1. **Load preferences.** Read `REVIEWER.md` from this skill's directory.
2. **Apply preferences to annotation generation.** When preparing annotations
   for any entry point (agent work, full review, MR review, etc.), check the
   code against known preferences. If a preference matches, generate an
   anticipated annotation with a note like `[matches pref-<id>]` in the
   annotation text so the reviewer can see it's preference-driven.
3. **Prioritize high-confidence preferences.** Always generate annotations for
   `high` confidence preferences. For `medium`, include them. For `low`, include
   only if the match is strong.

### After every review session (during synthesis)

After the review walk completes and session synthesis is done, run a
**preference discovery pass:**

1. **Scan user annotations.** Look at all `source: "user"` annotations and
   discussion from denied files. Identify patterns:
   - Repeated feedback themes (same comment on multiple files)
   - Style/naming corrections
   - Structural preferences (file organization, abstraction boundaries)
   - Pattern preferences (what they like vs. what they flag)
   - Things they praised (positive preferences)
2. **Diff against existing preferences.** Check if the observed patterns are
   already captured in `REVIEWER.md`.
3. **If new preferences are found:**
   - Present each candidate preference clearly, using the format from
     `REVIEWER.md` (ID, category, scope, description, example).
   - Ask: _"I noticed these review preferences — want me to save them?"_
   - Use `choose_options` with multi-select if there are multiple candidates.
   - For approved preferences, append them to the `## Preferences` section
     of `REVIEWER.md`.
4. **If existing preferences are reinforced** (user gave feedback matching an
   existing preference):
   - Bump `confidence` if appropriate (`low` → `medium` → `high`).
   - Update `Last seen` date.
   - Do this silently — no need to ask for confirmation on reinforcement.
5. **Promotion suggestions.** When a preference reaches `high` confidence and
   has scope `global` or `frontend`, suggest lifting it to the appropriate
   `AGENTS.md`. Do not do this automatically — just mention it during synthesis.

### Preference hygiene

`REVIEWER.md` must stay lean and scannable. Target: **≤ 30 active preferences.**

1. **Merge over create.** Before adding a new preference, check if an existing
   one covers the same concern. If so, update the existing entry (broaden the
   description, add a second example, bump confidence) instead of creating a
   near-duplicate.
2. **Retire stale preferences.** During preference loading (before a session),
   scan `Last seen` dates. If a preference has not been reinforced in 90+ days
   and is still `low` confidence, move it to the `## Retired` section at the
   bottom of `REVIEWER.md` (don't delete — it may resurface).
3. **Promote to graduate.** Once a preference is promoted to an `AGENTS.md`
   file, remove it from the active list and add a one-line entry to the
   `## Promoted` section noting where it went (e.g.
   `pref-handler-naming → ~/.pi/agent/AGENTS.md § Code Style`).
4. **Consolidate related preferences.** If 3+ preferences share a category and
   overlap significantly, consolidate them into a single broader preference.
   Preserve the highest confidence and earliest discovery date.
5. **Cap examples.** Each preference gets at most 2 short examples. Replace
   older examples only if a newer one is clearer.

### Preference structure (for liftability)

Preferences in `REVIEWER.md` are deliberately structured to be inspectable and
liftable:

- **Global scope** preferences can be promoted to `~/.pi/agent/AGENTS.md`
  (Code Style, Patterns I Value, Patterns to Avoid sections).
- **Frontend scope** preferences can be promoted to project-level `AGENTS.md`
  files.
- **Project-specific** preferences stay in `REVIEWER.md` but reference the
  project they apply to.
- **Personal** preferences (subjective taste) stay in `REVIEWER.md` permanently.

When suggesting a promotion, show the exact text that would be added to the
target file so the user can approve it.

## Rules

- **Always create the session file.** At the start of every multi-file review,
  create the session file at `/tmp/pi-review-sessions/`. Update it after each
  file's Quill output. This is not optional — the session file must exist and
  be current throughout the walk, not reconstructed after the fact.
- **Always load reviewer preferences.** Before entering any review loop, read
  `REVIEWER.md` from this skill's directory. If the file doesn't exist, create
  it from the template. Preference loading is not optional.
- **Always run preference discovery.** After every multi-file review session,
  run the preference discovery pass described in § Reviewer Preferences. For
  single-file ad-hoc inspections, only run discovery if the user provided
  substantive feedback (annotations or discussion).
- **Never open Quill spontaneously.** Only enter the review loop when explicitly
  triggered by the user or by another skill's documented integration point (e.g.
  archivist pre-commit gate).
- **One file at a time.** Quill reviews one file per invocation. The loop handles
  sequencing.
- **Respect abort.** When the user aborts, stop immediately. No "are you sure?"
  — go straight to synthesis.
- **Session files are the source of truth.** All review state lives in the
  session file. If the user asks "what did we review?", read the session file.
- **Deny is a conversation, not a failure.** Treat deny as a collaborative
  checkpoint, not an error state.
