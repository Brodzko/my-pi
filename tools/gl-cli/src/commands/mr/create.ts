import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const CreateInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  targetBranch: z.string().default('master'),
  reviewers: z.array(z.string()).default([]),
  squash: z.boolean().default(true),
  removeBranch: z.boolean().default(true),
  draft: z.boolean().default(false),
  labels: z.array(z.string()).default([]),
  dryRun: z.boolean().default(false),
});

export const createCommand = defineCommand({
  meta: { name: 'create', description: 'Create a merge request' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    title: {
      type: 'string',
      description: 'MR title (required)',
    },
    description: {
      type: 'string',
      description: 'MR description body',
    },
    'target-branch': {
      type: 'string',
      description: 'Target branch (default: master)',
      default: 'master',
    },
    reviewer: {
      type: 'string',
      description:
        'Comma-separated reviewer usernames (without @), can be repeated',
    },
    squash: {
      type: 'boolean',
      description: 'Squash commits on merge (default: true)',
      default: true,
    },
    'remove-branch': {
      type: 'boolean',
      description: 'Delete source branch on merge (default: true)',
      default: true,
    },
    draft: {
      type: 'boolean',
      description: 'Create as draft MR',
      default: false,
    },
    label: {
      type: 'string',
      description: 'Comma-separated labels',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate and show what would be created without executing',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(CreateInputSchema, 'MrCreateInput');

      await ensureAuth();

      const title = args.title;
      if (!title) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--title is required');
      }

      const targetBranch = args['target-branch'] ?? 'master';
      const reviewers = args.reviewer
        ? args.reviewer.split(',').map(r => r.trim())
        : [];
      const labels = args.label ? args.label.split(',').map(l => l.trim()) : [];
      const squash = args.squash ?? true;
      const removeBranch = args['remove-branch'] ?? true;
      const draft = args.draft ?? false;
      const dryRun = args['dry-run'] ?? false;

      const payload = {
        title,
        description: args.description ?? undefined,
        targetBranch,
        reviewers,
        labels,
        squash,
        removeBranch,
        draft,
      };

      if (dryRun) {
        log('[gl] Dry run: would create MR');
        outputJson(
          success(
            { dryRun: true, would: 'create', ...payload },
            { dryRun: true }
          )
        );
        return;
      }

      const glabArgs = [
        'mr',
        'create',
        '--title',
        title,
        '--target-branch',
        targetBranch,
        '--no-editor',
        '--yes',
      ];

      const description = args.description;
      if (description) {
        glabArgs.push('--description', description);
      }

      for (const reviewer of reviewers) {
        glabArgs.push('--reviewer', reviewer);
      }

      for (const l of labels) {
        glabArgs.push('--label', l);
      }

      if (squash) {
        glabArgs.push('--squash-before-merge');
      }

      if (removeBranch) {
        glabArgs.push('--remove-source-branch');
      }

      if (draft) {
        glabArgs.push('--draft');
      }

      const stdout = await execGlab(glabArgs);

      // glab mr create outputs a URL or text; try to parse JSON if --output json is supported,
      // otherwise extract the URL from stdout
      const webUrlMatch = stdout.match(/https?:\/\/\S+merge_requests\/\d+/);
      const iidMatch = stdout.match(/!(\d+)/);

      const webUrl = webUrlMatch?.[0] ?? null;
      const iid = iidMatch?.[1] ? parseInt(iidMatch[1], 10) : null;

      outputJson(
        success({
          created: true,
          iid,
          webUrl,
          title,
          targetBranch,
          reviewers,
          squash,
          removeBranch,
          draft,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
