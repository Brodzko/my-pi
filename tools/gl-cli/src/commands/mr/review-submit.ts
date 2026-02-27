import { defineCommand } from 'citty';
import { readFile } from 'node:fs/promises';
import { ReviewSchema, type ReviewAction } from '../../schemas/review.js';
import { ensureAuth } from '../../lib/auth.js';
import { execGlab, execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

type ActionResult = {
  index: number;
  type: string;
  id?: string | number;
  discussionId?: string;
};

type ActionFailure = {
  index: number;
  type: string;
  error: { code: string; message: string };
};

/** Execute a single review action. Returns id/discussionId on success, throws on failure. */
const executeAction = async (
  projectId: string,
  iid: number,
  action: ReviewAction
): Promise<{ id?: string | number; discussionId?: string }> => {
  switch (action.type) {
    case 'note': {
      const stdout = await execGlab([
        'mr',
        'note',
        String(iid),
        '--message',
        action.body,
      ]);
      const urlMatch = stdout.match(/https?:\/\/\S+/);
      return { id: urlMatch?.[0] ?? 'created' };
    }

    case 'line_comment': {
      const versions = await execGlabJson(
        ['api', 'GET', `/projects/${projectId}/merge_requests/${iid}/versions`],
        data =>
          data as {
            base_commit_sha: string;
            start_commit_sha: string;
            head_commit_sha: string;
          }[]
      );
      const latest = versions[0];
      if (!latest)
        throw new GlError(ErrorCode.UPSTREAM_ERROR, 'No diff versions found');

      const mrChanges = await execGlabJson(
        ['api', 'GET', `/projects/${projectId}/merge_requests/${iid}/changes`],
        data =>
          data as {
            changes: {
              old_path: string;
              new_path: string;
              diff: string;
            }[];
          }
      );

      const fileChange = mrChanges.changes.find(
        c => c.new_path === action.file || c.old_path === action.file
      );
      if (!fileChange) {
        throw new GlError(
          ErrorCode.LINE_NOT_IN_DIFF,
          `File "${action.file}" not in diff`
        );
      }

      const result = await execGlabJson(
        [
          'api',
          'POST',
          `/projects/${projectId}/merge_requests/${iid}/discussions`,
          '-f',
          `body=${action.body}`,
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
          ...(action.lineType === 'new'
            ? ['-f', `position[new_line]=${action.line}`]
            : ['-f', `position[old_line]=${action.line}`]),
        ],
        data => data as { id: string; notes: { id: number }[] }
      );
      return { discussionId: result.id, id: result.notes[0]?.id };
    }

    case 'reply': {
      const result = await execGlabJson(
        [
          'api',
          'POST',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${action.discussionId}/notes`,
          '-f',
          `body=${action.body}`,
        ],
        data => data as { id: number }
      );
      return { id: result.id, discussionId: action.discussionId };
    }

    case 'resolve': {
      await execGlabJson(
        [
          'api',
          'PUT',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${action.discussionId}`,
          '-f',
          'resolved=true',
        ],
        data => data
      );
      return { discussionId: action.discussionId };
    }

    case 'unresolve': {
      await execGlabJson(
        [
          'api',
          'PUT',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${action.discussionId}`,
          '-f',
          'resolved=false',
        ],
        data => data
      );
      return { discussionId: action.discussionId };
    }
  }
};

export const reviewSubmitCommand = defineCommand({
  meta: {
    name: 'submit',
    description: 'Submit a batch review from review.json',
  },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    input: {
      type: 'string',
      description: 'Path to review.json file (required)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate and report what would happen',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema) printSchemaAndExit(ReviewSchema, 'ReviewInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      if (!args.input)
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--input is required');

      // 1. Read and validate review.json
      let rawContent: string;
      try {
        rawContent = await readFile(args.input, 'utf-8');
      } catch {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot read file: ${args.input}`
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawContent);
      } catch {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid JSON in ${args.input}`
        );
      }

      const parseResult = ReviewSchema.safeParse(rawJson);
      if (!parseResult.success) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          'Invalid review.json schema',
          {
            errors: parseResult.error.issues.map(i => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          }
        );
      }

      const review = parseResult.data;

      // Validate iid match
      if (review.iid !== iid) {
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          `IID mismatch: --iid ${iid} vs review.json iid ${review.iid}`
        );
      }

      const projectId = await encodedProject();
      const dryRun = args['dry-run'] ?? false;

      // 2. Strict checks
      if (
        review.strictChecks.requireGreenPipeline ||
        review.strictChecks.requireNotDraft ||
        review.strictChecks.requireNoUnresolvedDiscussions
      ) {
        const mrRaw = await execGlabJson(
          ['api', 'GET', `/projects/${projectId}/merge_requests/${iid}`],
          data =>
            data as {
              draft: boolean;
              head_pipeline?: { status: string } | null;
              blocking_discussions_resolved?: boolean;
            }
        );

        if (review.strictChecks.requireNotDraft && mrRaw.draft) {
          throw new GlError(
            ErrorCode.PRECONDITION_FAILED,
            'MR is still in draft state'
          );
        }

        if (review.strictChecks.requireGreenPipeline) {
          const pipelineStatus = mrRaw.head_pipeline?.status;
          if (pipelineStatus !== 'success') {
            throw new GlError(
              ErrorCode.PRECONDITION_FAILED,
              `Pipeline status is "${pipelineStatus ?? 'none'}", expected "success"`
            );
          }
        }

        if (review.strictChecks.requireNoUnresolvedDiscussions) {
          if (mrRaw.blocking_discussions_resolved === false) {
            throw new GlError(
              ErrorCode.PRECONDITION_FAILED,
              'MR has unresolved discussions'
            );
          }
        }
      }

      // 3. Dry run: report plan
      if (dryRun) {
        log('[gl] Dry run: validating review plan');
        outputJson(
          success(
            {
              dryRun: true,
              iid,
              totalActions: review.actions.length,
              actions: review.actions.map((a, i) => ({
                index: i,
                type: a.type,
              })),
              final: review.final,
            },
            { dryRun: true }
          )
        );
        return;
      }

      // 4. Execute actions sequentially
      const applied: ActionResult[] = [];
      const failed: ActionFailure[] = [];

      for (let i = 0; i < review.actions.length; i++) {
        const action = review.actions[i]!;
        try {
          const result = await executeAction(projectId, iid, action);
          applied.push({ index: i, type: action.type, ...result });
        } catch (err) {
          const glErr =
            err instanceof GlError
              ? { code: err.code, message: err.message }
              : {
                  code: 'UNKNOWN',
                  message: err instanceof Error ? err.message : String(err),
                };
          failed.push({ index: i, type: action.type, error: glErr });
        }
      }

      // 5. Post summary note if provided
      let summary: { posted: boolean; id?: string } = { posted: false };
      if (review.final.summary) {
        try {
          const stdout = await execGlab([
            'mr',
            'note',
            String(iid),
            '--message',
            review.final.summary,
          ]);
          const urlMatch = stdout.match(/https?:\/\/\S+/);
          summary = {
            posted: true,
            id: urlMatch?.[0] ?? undefined,
          };
        } catch (err) {
          log(
            '[gl] Warning: failed to post summary note:',
            err instanceof Error ? err.message : err
          );
        }
      }

      // 6. Approve if requested
      let approval: { attempted: boolean; approved: boolean } = {
        attempted: false,
        approved: false,
      };
      if (review.final.approve) {
        try {
          await execGlab(['mr', 'approve', String(iid)]);
          approval = { attempted: true, approved: true };
        } catch (err) {
          log(
            '[gl] Warning: failed to approve:',
            err instanceof Error ? err.message : err
          );
          approval = { attempted: true, approved: false };
        }
      }

      outputJson(
        success(
          { applied, failed, summary, approval },
          {
            dryRun: false,
            totalActions: review.actions.length,
            succeeded: applied.length,
            failed: failed.length,
          }
        )
      );
    } catch (err) {
      outputError(err);
    }
  },
});
