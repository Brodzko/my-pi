import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { outputJson, outputError, success } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const InputSchema = z.object({
  iid: z.number().int().positive(),
  branchName: z.string().optional(),
  detach: z.boolean().default(false),
});

export const checkoutCommand = defineCommand({
  meta: {
    name: 'checkout',
    description: 'Checkout a merge request branch locally',
  },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: {
      type: 'string',
      description: 'Merge request IID (required)',
    },
    'branch-name': {
      type: 'string',
      description: 'Local branch name to use',
    },
    detach: {
      type: 'boolean',
      description: 'Detached HEAD checkout',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) {
        printSchemaAndExit(InputSchema, 'MrCheckoutInput');
      }

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }

      const glabArgs = ['mr', 'checkout', String(iid)];
      if (args['branch-name']) glabArgs.push('--branch', args['branch-name']);
      if (args.detach) glabArgs.push('--detach');

      await execGlab(glabArgs);

      outputJson(
        success({
          iid,
          checkedOut: true,
          branchName: args['branch-name'] ?? null,
          detach: args.detach ?? false,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
