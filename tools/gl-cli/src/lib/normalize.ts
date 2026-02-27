import type { GlabMr } from '../schemas/mr.js';
import type {
  MrSummary,
  MrBasics,
  MrChange,
  Discussion,
} from '../schemas/mr.js';

export const normalizeMrSummary = (
  raw: GlabMr,
  extra?: { unresolvedDiscussions?: number; approvedByMe?: boolean }
): MrSummary => ({
  iid: raw.iid,
  title: raw.title,
  author: raw.author.username,
  reviewers: raw.reviewers.map(r => r.username),
  assignees: raw.assignees.map(a => a.username),
  draft: raw.draft,
  state: raw.state,
  sourceBranch: raw.source_branch,
  targetBranch: raw.target_branch,
  labels: raw.labels,
  webUrl: raw.web_url,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  pipelineStatus: raw.head_pipeline?.status ?? null,
  unresolvedDiscussions: extra?.unresolvedDiscussions ?? null,
  approvedByMe: extra?.approvedByMe ?? null,
});

export const normalizeMrBasics = (raw: GlabMr): MrBasics => ({
  iid: raw.iid,
  title: raw.title,
  description: raw.description,
  author: raw.author.username,
  reviewers: raw.reviewers.map(r => r.username),
  assignees: raw.assignees.map(a => a.username),
  draft: raw.draft,
  state: raw.state,
  sourceBranch: raw.source_branch,
  targetBranch: raw.target_branch,
  labels: raw.labels,
  webUrl: raw.web_url,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  mergeStatus: raw.merge_status ?? null,
});

type RawChange = {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
};

const countDiffLines = (
  diff: string
): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
};

export const normalizeChange = (raw: RawChange): MrChange => {
  const changeType = raw.new_file
    ? 'added'
    : raw.deleted_file
      ? 'deleted'
      : raw.renamed_file
        ? 'renamed'
        : 'modified';
  const { additions, deletions } = countDiffLines(raw.diff);
  return {
    oldPath: raw.old_path,
    newPath: raw.new_path,
    changeType,
    additions,
    deletions,
  };
};

type RawNote = {
  id: number;
  author: { username: string };
  body: string;
  created_at: string;
  system: boolean;
};

type RawPosition = {
  new_path?: string;
  old_path?: string;
  new_line?: number | null;
  old_line?: number | null;
  position_type?: string;
};

type RawDiscussion = {
  id: string;
  notes: RawNote[];
};

export const normalizeDiscussion = (raw: RawDiscussion): Discussion | null => {
  // Filter out system notes
  const humanNotes = raw.notes.filter(n => !n.system);
  if (humanNotes.length === 0) return null;

  // Extract position from first note if it has one
  const firstNote = humanNotes[0]!;
  const rawPos = (firstNote as unknown as { position?: RawPosition }).position;
  const position =
    rawPos && rawPos.position_type === 'text'
      ? {
          file: rawPos.new_path ?? rawPos.old_path ?? '',
          newLine: rawPos.new_line ?? null,
          oldLine: rawPos.old_line ?? null,
          lineType:
            rawPos.new_line != null
              ? ('new' as const)
              : rawPos.old_line != null
                ? ('old' as const)
                : null,
        }
      : null;

  // Resolvable is only true for discussions with a position or that are explicitly resolvable
  const firstRawNote = raw.notes[0] as unknown as {
    resolvable?: boolean;
    resolved?: boolean;
  };
  const resolved = firstRawNote?.resolvable
    ? (firstRawNote.resolved ?? false)
    : null;

  return {
    id: raw.id,
    resolved,
    position,
    notes: humanNotes.map(n => ({
      id: n.id,
      author: n.author.username,
      body: n.body,
      createdAt: n.created_at,
    })),
  };
};
