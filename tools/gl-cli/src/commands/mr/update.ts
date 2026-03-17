import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const UpdateInputSchema = z.object({
  iid: z.number().int().positive(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  targetBranch: z.string().optional(),
  addReviewers: z.array(z.string()).default([]),
  removeReviewers: z.array(z.string()).default([]),
  addLabels: z.array(z.string()).default([]),
  removeLabels: z.array(z.string()).default([]),
  addAssignees: z.array(z.string()).default([]),
  removeAssignees: z.array(z.string()).default([]),
  draft: z.boolean().optional(),
  squash: z.boolean().optional(),
  dryRun: z.boolean().default(false),
});

export const updateCommand = defineCommand({
  meta: { name: 'update', description: 'Update an existing merge request' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: {
      type: 'string',
      description: 'MR IID (required)',
    },
    title: {
      type: 'string',
      description: 'New MR title',
    },
    description: {
      type: 'string',
      description: 'New MR description body',
    },
    'target-branch': {
      type: 'string',
      description: 'New target branch',
    },
    'add-reviewer': {
      type: 'string',
      description: 'Comma-separated reviewer usernames to add (without @)',
    },
    'remove-reviewer': {
      type: 'string',
      description: 'Comma-separated reviewer usernames to remove (without @)',
    },
    'add-label': {
      type: 'string',
      description: 'Comma-separated labels to add',
    },
    'remove-label': {
      type: 'string',
      description: 'Comma-separated labels to remove',
    },
    'add-assignee': {
      type: 'string',
      description: 'Comma-separated assignee usernames to add (without @)',
    },
    'remove-assignee': {
      type: 'string',
      description: 'Comma-separated assignee usernames to remove (without @)',
    },
    draft: {
      type: 'boolean',
      description:
        'Set draft status (true = mark as draft, false = mark as ready)',
    },
    squash: {
      type: 'boolean',
      description: 'Set squash-before-merge',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate and show what would be updated without executing',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(UpdateInputSchema, 'MrUpdateInput');

      await ensureAuth();

      const iidRaw = args.iid;
      if (!iidRaw) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--iid is required');
      }
      const iid = parseInt(iidRaw, 10);
      if (Number.isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }

      const splitCsv = (v: string | undefined): string[] =>
        v
          ? v
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          : [];

      const addReviewers = splitCsv(args['add-reviewer']);
      const removeReviewers = splitCsv(args['remove-reviewer']);
      const addLabels = splitCsv(args['add-label']);
      const removeLabels = splitCsv(args['remove-label']);
      const addAssignees = splitCsv(args['add-assignee']);
      const removeAssignees = splitCsv(args['remove-assignee']);
      const dryRun = args['dry-run'] ?? false;

      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description !== undefined && args.description !== '')
        updates.description = args.description;
      if (args['target-branch']) updates.targetBranch = args['target-branch'];
      if (addReviewers.length > 0) updates.addReviewers = addReviewers;
      if (removeReviewers.length > 0) updates.removeReviewers = removeReviewers;
      if (addLabels.length > 0) updates.addLabels = addLabels;
      if (removeLabels.length > 0) updates.removeLabels = removeLabels;
      if (addAssignees.length > 0) updates.addAssignees = addAssignees;
      if (removeAssignees.length > 0) updates.removeAssignees = removeAssignees;
      if (args.draft !== undefined) updates.draft = args.draft;
      if (args.squash !== undefined) updates.squash = args.squash;

      if (Object.keys(updates).length === 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          'At least one update field must be provided'
        );
      }

      if (dryRun) {
        log('[gl] Dry run: would update MR');
        outputJson(
          success(
            { dryRun: true, would: 'update', iid, ...updates },
            { dryRun: true }
          )
        );
        return;
      }

      const glabArgs = ['mr', 'update', String(iid)];

      if (args.title) {
        glabArgs.push('--title', args.title);
      }

      if (args.description !== undefined && args.description !== '') {
        glabArgs.push('--description', args.description);
      }

      if (args['target-branch']) {
        glabArgs.push('--target-branch', args['target-branch']);
      }

      for (const reviewer of addReviewers) {
        glabArgs.push('--reviewer', reviewer);
      }

      // glab mr update doesn't have --remove-reviewer natively,
      // but --unlabel exists for labels. For reviewers we use the full list approach.
      // For now, log a warning if remove-reviewer is used.
      if (removeReviewers.length > 0) {
        log(
          '[gl] Warning: --remove-reviewer is not natively supported by glab. Ignored.'
        );
      }

      for (const l of addLabels) {
        glabArgs.push('--label', l);
      }

      for (const l of removeLabels) {
        glabArgs.push('--unlabel', l);
      }

      for (const assignee of addAssignees) {
        glabArgs.push('--assignee', assignee);
      }

      if (removeAssignees.length > 0) {
        log(
          '[gl] Warning: --remove-assignee is not natively supported by glab. Ignored.'
        );
      }

      if (args.draft === true) {
        glabArgs.push('--draft');
      } else if (args.draft === false) {
        glabArgs.push('--ready');
      }

      if (args.squash === true) {
        glabArgs.push('--squash-before-merge');
      }

      const stdout = await execGlab(glabArgs);

      const webUrlMatch = stdout.match(/https?:\/\/\S+merge_requests\/\d+/);

      outputJson(
        success({
          updated: true,
          iid,
          webUrl: webUrlMatch?.[0] ?? null,
          ...updates,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
