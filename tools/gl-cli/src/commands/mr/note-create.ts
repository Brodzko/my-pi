import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab, execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const InputSchema = z.object({
  iid: z.number().int().positive(),
  body: z.string().min(1),
  unique: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export const noteCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a general note on a merge request',
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
    body: {
      type: 'string',
      description: 'Note body text (required)',
    },
    unique: {
      type: 'boolean',
      description: 'Skip if a note with identical body already exists',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without creating',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) {
        printSchemaAndExit(InputSchema, 'MrNoteCreateInput');
      }

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }
      if (!args.body) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--body is required');
      }

      const dryRun = args['dry-run'] ?? false;

      // Unique check: see if body already exists
      if (args.unique) {
        const projectId = await encodedProject();
        const notes = await execGlabJson(
          [
            'api',
            'GET',
            `/projects/${projectId}/merge_requests/${iid}/notes`,
            '--per-page',
            '100',
          ],
          data => data as { body: string; system: boolean }[]
        );
        const existing = notes.find(
          n => !n.system && n.body.trim() === args.body.trim()
        );
        if (existing) {
          log(
            '[gl] Note with identical body already exists, skipping (--unique)'
          );
          outputJson(
            success({ skipped: true, reason: 'duplicate' }, { dryRun })
          );
          return;
        }
      }

      if (dryRun) {
        log('[gl] Dry run: would create note');
        outputJson(
          success({ dryRun: true, would: 'create_note', iid }, { dryRun: true })
        );
        return;
      }

      const stdout = await execGlab([
        'mr',
        'note',
        String(iid),
        '--message',
        args.body,
      ]);

      // glab mr note doesn't return JSON — extract URL from output
      const urlMatch = stdout.match(/https?:\/\/\S+/);
      outputJson(
        success({
          created: true,
          iid,
          noteUrl: urlMatch?.[0] ?? null,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
