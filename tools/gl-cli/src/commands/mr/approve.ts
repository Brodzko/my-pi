import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const ApproveInputSchema = z.object({
  iid: z.number().int().positive(),
  sha: z.string().optional(),
  dryRun: z.boolean().default(false),
});

export const approveCommand = defineCommand({
  meta: { name: 'approve', description: 'Approve a merge request' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    sha: {
      type: 'string',
      description: 'Expected HEAD SHA for safety check',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without approving',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(ApproveInputSchema, 'MrApproveInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );

      const dryRun = args['dry-run'] ?? false;

      if (dryRun) {
        log('[gl] Dry run: would approve MR');
        outputJson(
          success({ dryRun: true, would: 'approve', iid }, { dryRun: true })
        );
        return;
      }

      const glabArgs = ['mr', 'approve', String(iid)];
      if (args.sha) glabArgs.push('--sha', args.sha);

      await execGlab(glabArgs);
      outputJson(success({ approved: true, iid }));
    } catch (err) {
      outputError(err);
    }
  },
});

const UnapproveInputSchema = z.object({
  iid: z.number().int().positive(),
  dryRun: z.boolean().default(false),
});

export const unapproveCommand = defineCommand({
  meta: {
    name: 'unapprove',
    description: 'Revoke approval of a merge request',
  },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without revoking',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema)
        printSchemaAndExit(UnapproveInputSchema, 'MrUnapproveInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );

      const dryRun = args['dry-run'] ?? false;

      if (dryRun) {
        log('[gl] Dry run: would revoke approval');
        outputJson(
          success({ dryRun: true, would: 'unapprove', iid }, { dryRun: true })
        );
        return;
      }

      await execGlab(['mr', 'revoke', String(iid)]);
      outputJson(success({ approved: false, iid }));
    } catch (err) {
      outputError(err);
    }
  },
});
