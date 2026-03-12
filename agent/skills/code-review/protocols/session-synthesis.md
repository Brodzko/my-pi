# Session synthesis protocol

After a multi-file review walk ends, read the session file and produce a
structured synthesis.

## Include

1. **Summary table** — each file, its decision, and annotation counts by
   source/intent when useful
2. **Cross-cutting patterns** — repeated issues or architecture concerns across
   files
3. **Unresolved items** — denied files, unanswered questions, files not reached
   due to abort
4. **Proposed actions** — concrete next steps
5. **Go / no-go recommendation** — only for pre-commit review
6. **GitLab comment proposal** — only for MR review, and only after applying
   `./gitlab-comment-synthesis.md`

## Output shape

Keep the synthesis in plain structured text. Ask the user what to act on next.

## Reviewer preferences update (mandatory)

After every review session, reflect on annotations the user created, patterns in
their approvals/denials, and discussion themes. Compare against `../REVIEWER.md`
and identify any new or reinforced preferences. Then:

- If new preferences were discovered, propose adding them to `REVIEWER.md` via
  `choose_options` (multi-select with the candidate preferences).
- If existing preferences were reinforced, bump their `Last seen` date and
  consider raising confidence.
- If no new preferences emerged, briefly state that and move on.

This step applies to every review session — multi-file, single-file, MR review,
pre-commit, or agent-work review. Do not skip it.

## Follow-up

- For pre-commit review, hand the outcome back to `archivist`.
- For MR review, present proposed GitLab comments for approval before posting.
