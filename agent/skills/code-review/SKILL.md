---
name: code-review
description: Router for code review workflows using Quill. Use for generic review requests, then hand off to the specific workflow for agent work, merge requests, files, or pre-commit review.
---

# Code Review

This is a **routing skill**.

It does not contain the full review protocol. Instead, route to the narrowest
matching workflow and load the shared review protocol docs only when needed.

Before any Quill-driven review, read:

- `../quill/SKILL.md` — tool contract and base output semantics
- `./REVIEWER.md` — learned reviewer preferences

## Routing

Choose the narrowest workflow:

- **Review the agent's changes** → use `review-agent-work`
- **Review a GitLab merge request** → use `review-merge-request`
- **Review specific files, a directory, or a feature area** → use `review-files`
- **Review staged changes before commit** → use `review-pre-commit`

## Shared review protocol

Workflow skills should read these docs as needed instead of re-embedding the
same instructions:

- `./protocols/review-loop.md`
- `./protocols/file-ordering.md`
- `./protocols/session-file.md`
- `./protocols/session-synthesis.md`
- `./protocols/gitlab-comment-synthesis.md` (MR review only)

## Scope

Use this router only when the request is broadly "review this" and the intent is
not yet specific. If the request already clearly matches one workflow, prefer
that workflow skill directly.
