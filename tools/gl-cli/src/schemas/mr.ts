import { z } from 'zod';

// --- Raw glab/API response schemas ---

export const GlabMrSchema = z.object({
  iid: z.number(),
  title: z.string(),
  description: z.string().nullable().default(null),
  author: z.object({ username: z.string() }),
  reviewers: z.array(z.object({ username: z.string() })).default([]),
  assignees: z.array(z.object({ username: z.string() })).default([]),
  draft: z.boolean().default(false),
  state: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  labels: z.array(z.string()).default([]),
  web_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  merge_status: z.string().optional(),
  head_pipeline: z
    .object({ status: z.string() })
    .nullable()
    .optional()
    .default(null),
  user_notes_count: z.number().optional().default(0),
});

export type GlabMr = z.infer<typeof GlabMrSchema>;

// --- Normalized domain types ---

export const MrSummarySchema = z.object({
  iid: z.number(),
  title: z.string(),
  author: z.string(),
  reviewers: z.array(z.string()),
  assignees: z.array(z.string()),
  draft: z.boolean(),
  state: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  labels: z.array(z.string()),
  webUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pipelineStatus: z.string().nullable(),
  unresolvedDiscussions: z.number().nullable(),
  approvedByMe: z.boolean().nullable(),
});

export type MrSummary = z.infer<typeof MrSummarySchema>;

export const MrBasicsSchema = z.object({
  iid: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  author: z.string(),
  reviewers: z.array(z.string()),
  assignees: z.array(z.string()),
  draft: z.boolean(),
  state: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  labels: z.array(z.string()),
  webUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergeStatus: z.string().nullable(),
});

export type MrBasics = z.infer<typeof MrBasicsSchema>;

export const ChangeTypeSchema = z.enum([
  'added',
  'deleted',
  'renamed',
  'modified',
]);

export const MrChangeSchema = z.object({
  oldPath: z.string(),
  newPath: z.string(),
  changeType: ChangeTypeSchema,
  additions: z.number(),
  deletions: z.number(),
});

export type MrChange = z.infer<typeof MrChangeSchema>;

export const DiscussionPositionSchema = z.object({
  file: z.string(),
  newLine: z.number().nullable(),
  oldLine: z.number().nullable(),
  lineType: z.enum(['new', 'old']).nullable(),
});

export const DiscussionNoteSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export const DiscussionSchema = z.object({
  id: z.string(),
  resolved: z.boolean().nullable(),
  position: DiscussionPositionSchema.nullable(),
  notes: z.array(DiscussionNoteSchema),
});

export type Discussion = z.infer<typeof DiscussionSchema>;

export const PipelineInfoSchema = z.object({
  id: z.number(),
  status: z.string(),
  webUrl: z.string(),
});

export const ApprovalInfoSchema = z.object({
  approved: z.boolean(),
  approvalsRequired: z.number(),
  approvalsLeft: z.number(),
  approvedBy: z.array(z.string()),
});

export const MrDetailSchema = z.object({
  basics: MrBasicsSchema.optional(),
  changes: z.array(MrChangeSchema).optional(),
  discussions: z.array(DiscussionSchema).optional(),
  pipeline: PipelineInfoSchema.nullable().optional(),
  approvals: ApprovalInfoSchema.optional(),
});

export type MrDetail = z.infer<typeof MrDetailSchema>;
