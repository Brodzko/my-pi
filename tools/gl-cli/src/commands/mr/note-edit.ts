import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

const InputSchema = z.object({
  iid: z.number().int().positive(),
  noteId: z.number().int().positive(),
  body: z.string().min(1),
  dryRun: z.boolean().default(false),
});

export const noteEditCommand = defineCommand({
  meta: {
    name: 'edit',
    description: 'Edit an existing note on a merge request',
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
    'note-id': {
      type: 'string',
      description: 'Note ID to edit (required)',
    },
    body: {
      type: 'string',
      description: 'New note body text (required)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without editing',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) {
        printSchemaAndExit(InputSchema, 'MrNoteEditInput');
      }

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }

      const noteId = parseInt(args['note-id'], 10);
      if (isNaN(noteId) || noteId <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--note-id must be a positive integer'
        );
      }

      if (!args.body) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--body is required');
      }

      const dryRun = args['dry-run'] ?? false;

      if (dryRun) {
        log('[gl] Dry run: would edit note');
        outputJson(
          success(
            { dryRun: true, would: 'edit_note', iid, noteId },
            { dryRun: true }
          )
        );
        return;
      }

      const projectId = await encodedProject();
      const result = await execGlabJson(
        [
          'api',
          `/projects/${projectId}/merge_requests/${iid}/notes/${noteId}`,
          '-X',
          'PUT',
          '-f',
          `body=${args.body}`,
        ],
        data => data as { id: number; body: string }
      );

      outputJson(
        success({
          edited: true,
          iid,
          noteId: result.id,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
