import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';
import { parseDiffLineRanges, isLineInRanges } from '../../lib/diff.js';

const InputSchema = z.object({
  iid: z.number().int().positive(),
  file: z.string().min(1),
  line: z.number().int().positive(),
  lineType: z.enum(['new', 'old']),
  body: z.string().min(1),
  dryRun: z.boolean().default(false),
});

type DiffVersion = {
  id: number;
  base_commit_sha: string;
  start_commit_sha: string;
  head_commit_sha: string;
};

type DiffFile = {
  old_path: string;
  new_path: string;
  diff: string;
};

export const noteCreateLineCommand = defineCommand({
  meta: {
    name: 'create-line',
    description: 'Create a line-level comment on a merge request diff',
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
    file: {
      type: 'string',
      description: 'File path in the diff (required)',
    },
    line: {
      type: 'string',
      description: 'Line number (required)',
    },
    'line-type': {
      type: 'string',
      description: 'Line type: new or old (required)',
    },
    body: {
      type: 'string',
      description: 'Comment body text (required)',
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
        printSchemaAndExit(InputSchema, 'MrNoteCreateLineInput');
      }

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      const line = parseInt(args.line, 10);
      const lineType = args['line-type'] as 'new' | 'old';
      const file = args.file;
      const body = args.body;
      const dryRun = args['dry-run'] ?? false;

      if (isNaN(iid) || iid <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      }
      if (isNaN(line) || line <= 0) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--line must be a positive integer'
        );
      }
      if (!['new', 'old'].includes(lineType)) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          "--line-type must be 'new' or 'old'"
        );
      }
      if (!file) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--file is required');
      }
      if (!body) {
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--body is required');
      }

      const projectId = await encodedProject();

      // 1. Get diff versions to resolve SHAs
      const versions = await execGlabJson(
        ['api', 'GET', `/projects/${projectId}/merge_requests/${iid}/versions`],
        data => data as DiffVersion[]
      );
      const latest = versions[0];
      if (!latest) {
        throw new GlError(
          ErrorCode.UPSTREAM_ERROR,
          'No diff versions found for this MR'
        );
      }

      // 2. Get MR changes to find the file and validate line
      const mrChanges = await execGlabJson(
        ['api', 'GET', `/projects/${projectId}/merge_requests/${iid}/changes`],
        data => data as { changes: DiffFile[] }
      );

      const fileChange = mrChanges.changes.find(
        c => c.new_path === file || c.old_path === file
      );
      if (!fileChange) {
        throw new GlError(
          ErrorCode.LINE_NOT_IN_DIFF,
          `File "${file}" not found in MR diff`,
          {
            file,
            availableFiles: mrChanges.changes.map(c => c.new_path),
          }
        );
      }

      // 3. Validate line is in diff
      const validRanges = parseDiffLineRanges(fileChange.diff, lineType);
      if (!isLineInRanges(line, validRanges)) {
        throw new GlError(
          ErrorCode.LINE_NOT_IN_DIFF,
          `Line ${line} (${lineType}) is not in the diff for "${file}"`,
          { file, line, lineType, validRanges }
        );
      }

      if (dryRun) {
        log('[gl] Dry run: would create line comment');
        outputJson(
          success(
            {
              dryRun: true,
              would: 'create_line_comment',
              iid,
              file,
              line,
              lineType,
            },
            { dryRun: true }
          )
        );
        return;
      }

      // 4. Create discussion with position
      const result = await execGlabJson(
        [
          'api',
          'POST',
          `/projects/${projectId}/merge_requests/${iid}/discussions`,
          '-f',
          `body=${body}`,
          '-f',
          `position[position_type]=text`,
          '-f',
          `position[base_sha]=${latest.base_commit_sha}`,
          '-f',
          `position[start_sha]=${latest.start_commit_sha}`,
          '-f',
          `position[head_sha]=${latest.head_commit_sha}`,
          '-f',
          `position[old_path]=${fileChange.old_path}`,
          '-f',
          `position[new_path]=${fileChange.new_path}`,
          ...(lineType === 'new'
            ? ['-f', `position[new_line]=${line}`]
            : ['-f', `position[old_line]=${line}`]),
        ],
        data => data as { id: string; notes: { id: number }[] }
      );

      outputJson(
        success({
          created: true,
          discussionId: result.id,
          noteId: result.notes[0]?.id ?? null,
          iid,
          file,
          line,
          lineType,
        })
      );
    } catch (err) {
      outputError(err);
    }
  },
});
