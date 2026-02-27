import { defineCommand } from 'citty';
import { z } from 'zod';
import { GlabMrSchema } from '../../schemas/mr.js';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab } from '../../lib/exec.js';
import { normalizeMrSummary } from '../../lib/normalize.js';
import { outputJson, outputError, success } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';

const InputSchema = z.object({
  author: z.string().optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  state: z.enum(['opened', 'merged', 'closed', 'all']).default('opened'),
  draft: z.enum(['true', 'false', 'any']).default('any'),
  label: z.string().optional(),
  notLabel: z.string().optional(),
  sort: z
    .enum(['updated_desc', 'updated_asc', 'created_desc', 'created_asc'])
    .default('updated_desc'),
  limit: z.number().int().positive().default(20),
  page: z.number().int().positive().default(1),
});

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'List merge requests' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    author: { type: 'string', description: 'Filter by author username' },
    assignee: { type: 'string', description: 'Filter by assignee username' },
    reviewer: {
      type: 'string',
      description: 'Filter by reviewer (use @me for self)',
    },
    state: {
      type: 'string',
      description: 'MR state: opened, merged, closed, all',
      default: 'opened',
    },
    draft: {
      type: 'string',
      description: 'Draft filter: true, false, any',
      default: 'any',
    },
    label: { type: 'string', description: 'Filter by label' },
    'not-label': { type: 'string', description: 'Exclude label' },
    sort: {
      type: 'string',
      description: 'Sort: updated_desc, updated_asc, created_desc, created_asc',
      default: 'updated_desc',
    },
    limit: {
      type: 'string',
      description: 'Max results per page',
      default: '20',
    },
    page: { type: 'string', description: 'Page number', default: '1' },
  },
  async run({ args }) {
    try {
      if (args.schema) {
        printSchemaAndExit(InputSchema, 'MrListInput');
      }

      await ensureAuth();

      const glabArgs = ['mr', 'list', '--output', 'json'];

      if (args.author) glabArgs.push('--author', args.author);
      if (args.assignee) glabArgs.push('--assignee', args.assignee);
      if (args.reviewer) glabArgs.push('--reviewer', args.reviewer);
      if (args.draft === 'true') glabArgs.push('--draft');
      if (args.draft === 'false') glabArgs.push('--no-draft');
      if (args.label) glabArgs.push('--label', args.label);
      if (args['not-label']) glabArgs.push('--not-label', args['not-label']);
      if (args.state && args.state !== 'opened') {
        glabArgs.push('--state', args.state);
      }

      const limit = parseInt(args.limit ?? '20', 10);
      const page = parseInt(args.page ?? '1', 10);
      glabArgs.push('--per-page', String(limit));
      glabArgs.push('--page', String(page));

      const stdout = await execGlab(glabArgs);
      const rawList = JSON.parse(stdout) as unknown[];

      const mrs = rawList.map(raw => {
        const parsed = GlabMrSchema.parse(raw);
        return normalizeMrSummary(parsed);
      });

      outputJson(
        success(mrs, {
          total: mrs.length,
          page,
          perPage: limit,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
