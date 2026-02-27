import { defineCommand } from 'citty';
import { z } from 'zod';
import { GlabMrSchema } from '../../schemas/mr.js';
import type { MrDetail } from '../../schemas/mr.js';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab, execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import {
  normalizeMrBasics,
  normalizeChange,
  normalizeDiscussion,
} from '../../lib/normalize.js';
import { outputJson, outputError, success } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const VALID_SECTIONS = [
  'basics',
  'changes',
  'discussions',
  'pipeline',
  'approvals',
] as const;
type Section = (typeof VALID_SECTIONS)[number];

const InputSchema = z.object({
  iid: z.number().int().positive(),
  include: z.string().default('basics'),
});

const parseSections = (include: string): Section[] => {
  const sections = include.split(',').map(s => s.trim()) as Section[];
  for (const s of sections) {
    if (!VALID_SECTIONS.includes(s)) {
      throw new GlError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid --include section: "${s}". Valid: ${VALID_SECTIONS.join(', ')}`
      );
    }
  }
  return sections;
};

export const getCommand = defineCommand({
  meta: { name: 'get', description: 'Get merge request details' },
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
    include: {
      type: 'string',
      description:
        'Comma-separated sections: basics,changes,discussions,pipeline,approvals',
      default: 'basics',
    },
  },
  async run({ args }) {
    try {
      if (args.schema) {
        printSchemaAndExit(InputSchema, 'MrGetInput');
      }

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }

      const sections = parseSections(args.include ?? 'basics');
      const projectId = await encodedProject();
      const result: MrDetail = {};

      if (sections.includes('basics')) {
        const stdout = await execGlab([
          'mr',
          'view',
          String(iid),
          '--output',
          'json',
        ]);
        const parsed = GlabMrSchema.parse(JSON.parse(stdout));
        result.basics = normalizeMrBasics(parsed);
      }

      if (sections.includes('changes')) {
        const raw = await execGlabJson(
          [
            'api',
            'GET',
            `/projects/${projectId}/merge_requests/${iid}/changes`,
          ],
          data => data as { changes: unknown[] }
        );
        result.changes = (raw.changes ?? []).map(c =>
          normalizeChange(c as Parameters<typeof normalizeChange>[0])
        );
      }

      if (sections.includes('discussions')) {
        const raw = await execGlabJson(
          [
            'api',
            'GET',
            `/projects/${projectId}/merge_requests/${iid}/discussions`,
          ],
          data => data as unknown[]
        );
        result.discussions = raw
          .map(d =>
            normalizeDiscussion(d as Parameters<typeof normalizeDiscussion>[0])
          )
          .filter((d): d is NonNullable<typeof d> => d !== null);
      }

      if (sections.includes('pipeline')) {
        try {
          const raw = await execGlabJson(
            [
              'api',
              'GET',
              `/projects/${projectId}/merge_requests/${iid}/pipelines`,
              '--per-page',
              '1',
            ],
            data => data as unknown[]
          );
          const latest = raw[0] as
            | { id: number; status: string; web_url: string }
            | undefined;
          result.pipeline = latest
            ? {
                id: latest.id,
                status: latest.status,
                webUrl: latest.web_url,
              }
            : null;
        } catch {
          result.pipeline = null;
        }
      }

      if (sections.includes('approvals')) {
        const raw = await execGlabJson(
          [
            'api',
            'GET',
            `/projects/${projectId}/merge_requests/${iid}/approvals`,
          ],
          data =>
            data as {
              approved: boolean;
              approvals_required: number;
              approvals_left: number;
              approved_by: { user: { username: string } }[];
            }
        );
        result.approvals = {
          approved: raw.approved,
          approvalsRequired: raw.approvals_required,
          approvalsLeft: raw.approvals_left,
          approvedBy: raw.approved_by.map(a => a.user.username),
        };
      }

      outputJson(success(result));
    } catch (err) {
      outputError(err);
    }
  },
});
