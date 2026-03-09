import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab, execGit } from '../../lib/exec.js';
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

      // After checkout, fast-forward the local branch to match the remote.
      // `glab mr checkout` doesn't pull when the branch already exists locally,
      // so we need to sync explicitly.
      if (!args.detach) {
        try {
          // Get the current branch's upstream ref
          const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
          await execGit(['fetch', 'origin', branch]);
          // Try fast-forward merge; if it fails (e.g. diverged), don't break checkout
          try {
            await execGit(['merge', '--ff-only', `origin/${branch}`]);
          } catch {
            // Not fast-forwardable — leave branch as-is, user can rebase manually
          }
        } catch {
          // fetch failed — offline or no tracking branch; non-fatal
        }
      }

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
