import { promises as fs } from 'node:fs';
import {
  parseSessionEntries,
  type ExtensionAPI,
  type ExtensionContext,
  type FileEntry,
} from '@mariozechner/pi-coding-agent';
import { toErrorMessage } from '../../shared/feedback';
import { z } from 'zod';
import { discoverSessions } from './query-discovery';
import { generateQueryAnswer, QueryGenerateError } from './query-generate';
import { collectRelatedSessions } from './query-related';
import { resolveSessionReference } from './query-resolve';
import {
  mapGenerateError,
  QUERY_SESSION_ERROR_CODES,
  QuerySessionToolError,
  toStatusFailureMessage,
  toTelemetryErrorMessage,
  toToolErrorMessage,
} from './query-session-errors';
import { loadSessionBranch } from './query-session-io';
import { serializeConversation } from '../../shared/conversation-serialize';
import { createQueryTelemetryEntry } from './query-telemetry';
import { createStatusNotifier } from './status';
import type { QuerySessionConfig, QuerySessionResult } from './types';

const QuerySessionArgsSchema = z
  .object({
    session: z.string().min(1),
    question: z.string().min(1),
  })
  .strict();

const QuerySessionResultSchema: z.ZodType<QuerySessionResult> = z
  .object({
    sessionId: z.string().min(1),
    sessionName: z.string().min(1),
    answerMarkdown: z.string().min(1),
    confidence: z.enum(['high', 'medium', 'low']),
    citations: z
      .array(
        z.object({
          entryId: z.string().min(1),
          role: z.enum(['user', 'assistant']),
          excerpt: z.string().min(1),
        })
      )
      .optional(),
    notes: z.array(z.string().min(1)).optional(),
  })
  .strict();

const QUERY_SESSION_TELEMETRY_TYPE = 'query-session:query_session';

export type QuerySessionCallCounter = {
  count: number;
};

export type QuerySessionDependencies = {
  discoverSessions: typeof discoverSessions;
  collectRelatedSessions: typeof collectRelatedSessions;
  generateQueryAnswer: typeof generateQueryAnswer;
  serializeConversation: typeof serializeConversation;
  createStatusNotifier: typeof createStatusNotifier;
  parseSessionEntries: (content: string) => FileEntry[];
  readFile: typeof fs.readFile;
  now: () => number;
};

const defaultDependencies: QuerySessionDependencies = {
  discoverSessions,
  collectRelatedSessions,
  generateQueryAnswer,
  serializeConversation,
  createStatusNotifier,
  parseSessionEntries,
  readFile: fs.readFile,
  now: Date.now,
};

export const createQuerySessionExecutor = (
  pi: ExtensionAPI,
  config: QuerySessionConfig,
  callCounter: QuerySessionCallCounter,
  dependencies?: Partial<QuerySessionDependencies>
) => {
  const deps: QuerySessionDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  return async (
    args: unknown,
    ctx: ExtensionContext
  ): Promise<QuerySessionResult> => {
    const parsedArgs = QuerySessionArgsSchema.safeParse(args);
    if (!parsedArgs.success) {
      throw new QuerySessionToolError(
        QUERY_SESSION_ERROR_CODES.invalidArgs,
        z.prettifyError(parsedArgs.error)
      );
    }

    const notifier = deps.createStatusNotifier(ctx, config);
    notifier.start();

    const startedAt = deps.now();

    let sourceSessionId: string | undefined;
    let sourceSessionName: string | undefined;
    let resolvedBy: 'id' | 'name-exact' | undefined;
    let serializedBytes = 0;
    let truncated = false;
    let notes: string[] = [];

    try {
      if (callCounter.count >= config.maxCallsPerTurn) {
        throw new QuerySessionToolError(
          QUERY_SESSION_ERROR_CODES.callLimitExceeded,
          `query_session call limit reached for this turn (max ${config.maxCallsPerTurn})`
        );
      }

      const discoveredSessions = await deps.discoverSessions(ctx, config);
      const resolvedResult = resolveSessionReference(
        discoveredSessions,
        parsedArgs.data.session
      );

      if (!resolvedResult.ok) {
        if (resolvedResult.error.code === 'SESSION_AMBIGUOUS') {
          throw new QuerySessionToolError(
            QUERY_SESSION_ERROR_CODES.sessionAmbiguous,
            `Ambiguous session reference: ${resolvedResult.error.session}`,
            {
              details: {
                candidates: resolvedResult.error.candidates.map(candidate => ({
                  sessionId: candidate.sessionId,
                  displayName: candidate.displayName,
                })),
              },
            }
          );
        }

        throw new QuerySessionToolError(
          QUERY_SESSION_ERROR_CODES.sessionNotFound,
          `Session not found: ${resolvedResult.error.session}`
        );
      }

      sourceSessionId = resolvedResult.value.sessionId;
      sourceSessionName = resolvedResult.value.displayName;
      resolvedBy = resolvedResult.value.resolvedBy;

      const relatedSessions = await deps.collectRelatedSessions(
        resolvedResult.value
      );

      const branchEntries = await Promise.all(
        relatedSessions.map(session =>
          loadSessionBranch(session.sessionFile, {
            parseSessionEntries: deps.parseSessionEntries,
            readFile: deps.readFile,
          })
        )
      );

      const serialized = deps.serializeConversation(branchEntries.flat(), {
        includeEntryId: true,
        maxBytes: config.maxBytes,
      });

      serializedBytes = serialized.serializedBytes;
      truncated = serialized.truncated;
      notes = truncated
        ? [`Context truncated to the most recent ${config.maxBytes} bytes.`]
        : [];

      if (!serialized.conversationText.trim()) {
        throw new QuerySessionToolError(
          QUERY_SESSION_ERROR_CODES.sessionEmpty,
          'No user/assistant conversation text found in the target session'
        );
      }

      callCounter.count += 1;

      let generated;
      try {
        generated = await deps.generateQueryAnswer({
          ctx,
          config,
          conversationText: serialized.conversationText,
          question: parsedArgs.data.question,
        });
      } catch (error) {
        if (error instanceof QueryGenerateError) {
          throw mapGenerateError(error);
        }

        throw error;
      }

      const result = QuerySessionResultSchema.parse({
        sessionId: sourceSessionId,
        sessionName: sourceSessionName,
        answerMarkdown: generated.output.answerMarkdown,
        confidence: generated.output.confidence,
        citations: generated.output.citations,
        notes: notes.length > 0 ? notes : undefined,
      });

      const usage = generated.usage;

      const latencyMs = deps.now() - startedAt;

      const telemetry = createQueryTelemetryEntry({
        success: true,
        timestamp: new Date().toISOString(),
        sourceSessionId,
        sourceSessionName,
        resolvedBy,
        model: generated.model,
        question: parsedArgs.data.question,
        confidence: result.confidence,
        usage,
        serializedBytes,
        truncated,
        latencyMs,
        notes,
      });

      pi.appendEntry(QUERY_SESSION_TELEMETRY_TYPE, telemetry);
      notifier.success(usage.cost.total);

      return result;
    } catch (error) {
      const latencyMs = deps.now() - startedAt;

      const mappedError =
        error instanceof QuerySessionToolError
          ? error
          : new QuerySessionToolError(
              QUERY_SESSION_ERROR_CODES.unknown,
              toErrorMessage(error, 'Unknown query_session error')
            );

      const telemetry = createQueryTelemetryEntry({
        success: false,
        timestamp: new Date().toISOString(),
        sourceSessionId,
        sourceSessionName,
        resolvedBy,
        model: mappedError.model,
        question: parsedArgs.data.question,
        usage: mappedError.usage,
        serializedBytes,
        truncated,
        latencyMs,
        error: toTelemetryErrorMessage(mappedError),
        notes,
      });

      pi.appendEntry(QUERY_SESSION_TELEMETRY_TYPE, telemetry);
      notifier.failure(toStatusFailureMessage(mappedError));

      throw new Error(toToolErrorMessage(mappedError));
    }
  };
};
