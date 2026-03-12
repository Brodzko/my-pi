---
name: gitlab-activity
description: Inspect GitLab activity for a person or team. Use when the user asks what someone has been working on, authored, or reviewed in GitLab.
---

# GitLab: activity

Before starting, read `../gitlab/common.md`.

Interpret questions like:

- "What has Alice been working on?"
- "What did Martin review lately?"
- "Show me Jan's recent activity"

as **GitLab MR activity**, not local git history.

## Workflow

1. Identify the target person or group.
2. Use `gl mr list` with author/reviewer filters to gather relevant MRs.
3. Summarize authored vs reviewed activity separately when both matter.
4. Prefer recent, still-open, or recently merged MRs first.
5. If the user asks for depth, follow up with `gl mr get --iid N --include basics` on the most relevant MRs.

## Examples

```bash
gl mr list --author alice --sort created_desc
gl mr list --reviewer alice --sort created_desc
gl mr list --author @me --state opened
```

Use this skill for activity discovery. For opening or reviewing an MR, switch to
a narrower workflow skill.
