import { z } from 'zod';

const NoteActionSchema = z.object({
  type: z.literal('note'),
  body: z.string().min(1),
});

const LineCommentActionSchema = z.object({
  type: z.literal('line_comment'),
  file: z.string().min(1),
  line: z.number().int().positive(),
  lineType: z.enum(['new', 'old']),
  body: z.string().min(1),
});

const ReplyActionSchema = z.object({
  type: z.literal('reply'),
  discussionId: z.string().min(1),
  body: z.string().min(1),
});

const ResolveActionSchema = z.object({
  type: z.literal('resolve'),
  discussionId: z.string().min(1),
});

const UnresolveActionSchema = z.object({
  type: z.literal('unresolve'),
  discussionId: z.string().min(1),
});

export const ReviewActionSchema = z.discriminatedUnion('type', [
  NoteActionSchema,
  LineCommentActionSchema,
  ReplyActionSchema,
  ResolveActionSchema,
  UnresolveActionSchema,
]);

export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const ReviewSchema = z.object({
  version: z.literal(1),
  iid: z.number().int().positive(),
  strictChecks: z
    .object({
      requireGreenPipeline: z.boolean().default(false),
      requireNoUnresolvedDiscussions: z.boolean().default(false),
      requireNotDraft: z.boolean().default(false),
    })
    .default({}),
  actions: z.array(ReviewActionSchema),
  final: z
    .object({
      approve: z.boolean().default(false),
      summary: z.string().optional(),
    })
    .default({}),
});

export type Review = z.infer<typeof ReviewSchema>;
