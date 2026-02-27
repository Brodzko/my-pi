import { defineCommand } from 'citty';
import { z } from 'zod';
import { ensureAuth } from '../../lib/auth.js';
import { execGlabJson } from '../../lib/exec.js';
import { encodedProject } from '../../lib/project.js';
import { outputJson, outputError, success, log } from '../../lib/envelope.js';
import { printSchemaAndExit } from '../../lib/schema-flag.js';
import { GlError, ErrorCode } from '../../lib/errors.js';

// --- Reply ---

const ReplyInputSchema = z.object({
  iid: z.number().int().positive(),
  discussionId: z.string().min(1),
  body: z.string().min(1),
  dryRun: z.boolean().default(false),
});

export const discussionReplyCommand = defineCommand({
  meta: { name: 'reply', description: 'Reply to a discussion' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    'discussion-id': {
      type: 'string',
      description: 'Discussion ID (required)',
    },
    body: { type: 'string', description: 'Reply body text (required)' },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without posting',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema)
        printSchemaAndExit(ReplyInputSchema, 'DiscussionReplyInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      const discussionId = args['discussion-id'];
      const body = args.body;
      const dryRun = args['dry-run'] ?? false;

      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      if (!discussionId)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--discussion-id is required'
        );
      if (!body)
        throw new GlError(ErrorCode.VALIDATION_ERROR, '--body is required');

      if (dryRun) {
        log('[gl] Dry run: would reply to discussion');
        outputJson(
          success(
            { dryRun: true, would: 'reply', iid, discussionId },
            { dryRun: true }
          )
        );
        return;
      }

      const projectId = await encodedProject();
      const result = await execGlabJson(
        [
          'api',
          'POST',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}/notes`,
          '-f',
          `body=${body}`,
        ],
        data => data as { id: number }
      );

      outputJson(
        success({ created: true, noteId: result.id, iid, discussionId })
      );
    } catch (err) {
      outputError(err);
    }
  },
});

// --- Resolve ---

const ResolveInputSchema = z.object({
  iid: z.number().int().positive(),
  discussionId: z.string().min(1),
  dryRun: z.boolean().default(false),
});

export const discussionResolveCommand = defineCommand({
  meta: { name: 'resolve', description: 'Resolve a discussion' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    'discussion-id': {
      type: 'string',
      description: 'Discussion ID (required)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without resolving',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema)
        printSchemaAndExit(ResolveInputSchema, 'DiscussionResolveInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      const discussionId = args['discussion-id'];
      const dryRun = args['dry-run'] ?? false;

      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      if (!discussionId)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--discussion-id is required'
        );

      if (dryRun) {
        log('[gl] Dry run: would resolve discussion');
        outputJson(
          success(
            { dryRun: true, would: 'resolve', iid, discussionId },
            { dryRun: true }
          )
        );
        return;
      }

      const projectId = await encodedProject();
      await execGlabJson(
        [
          'api',
          'PUT',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}`,
          '-f',
          'resolved=true',
        ],
        data => data
      );

      outputJson(success({ resolved: true, iid, discussionId }));
    } catch (err) {
      outputError(err);
    }
  },
});

// --- Unresolve ---

export const discussionUnresolveCommand = defineCommand({
  meta: { name: 'unresolve', description: 'Unresolve a discussion' },
  args: {
    schema: {
      type: 'boolean',
      description: 'Print input JSON schema and exit',
      default: false,
    },
    iid: { type: 'string', description: 'Merge request IID (required)' },
    'discussion-id': {
      type: 'string',
      description: 'Discussion ID (required)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Validate without unresolving',
      default: false,
    },
  },
  async run({ args }) {
    try {
      if (args.schema)
        printSchemaAndExit(ResolveInputSchema, 'DiscussionUnresolveInput');

      await ensureAuth();

      const iid = parseInt(args.iid, 10);
      const discussionId = args['discussion-id'];
      const dryRun = args['dry-run'] ?? false;

      if (isNaN(iid) || iid <= 0)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--iid must be a positive integer'
        );
      if (!discussionId)
        throw new GlError(
          ErrorCode.VALIDATION_ERROR,
          '--discussion-id is required'
        );

      if (dryRun) {
        log('[gl] Dry run: would unresolve discussion');
        outputJson(
          success(
            { dryRun: true, would: 'unresolve', iid, discussionId },
            { dryRun: true }
          )
        );
        return;
      }

      const projectId = await encodedProject();
      await execGlabJson(
        [
          'api',
          'PUT',
          `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}`,
          '-f',
          'resolved=false',
        ],
        data => data
      );

      outputJson(success({ resolved: false, iid, discussionId }));
    } catch (err) {
      outputError(err);
    }
  },
});
