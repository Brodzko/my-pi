import {
  DEFAULT_MAX_BYTES,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
} from '@mariozechner/pi-coding-agent';
import { serializeConversation } from '../../shared/conversation-serialize';
import {
  formatUsdCost,
  notifyInvalidConfig,
  notifyMissingModels,
  toErrorMessage,
} from '../../shared/feedback';
import { resolveTextModelAvailability } from '../../shared/model-availability';
import {
  type SessionMeta as MetaFile,
  readSessionMetaFile as readMetaFile,
  writeSessionMetaFileAtomic as writeMetaFileAtomic,
} from '../../shared/session-meta';
import { createStatusController } from '../../shared/status';
import { sessionIndexConfigLoadResult } from './config';
import { createDebugLogger, serializeError } from './debug-log';
import { type GenerateAttempt, generateSessionMeta } from './generate';

const sessionIndexConfig = sessionIndexConfigLoadResult.config;

const isUserMessageEntry = (entry: SessionEntry): boolean =>
  entry.type === 'message' && entry.message.role === 'user';

const countNewUserMessages = (
  branch: SessionEntry[],
  lastIndexedLeafId: string | undefined
): number => {
  if (!lastIndexedLeafId) {
    return branch.filter(isUserMessageEntry).length;
  }

  const lastIndexedPosition = branch.findIndex(
    entry => entry.id === lastIndexedLeafId
  );
  const startIndex = lastIndexedPosition === -1 ? 0 : lastIndexedPosition + 1;
  return branch.slice(startIndex).filter(isUserMessageEntry).length;
};

const serializeConversationForIndexing = (entries: SessionEntry[]): string => {
  const serialized = serializeConversation(entries, {
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!serialized.truncated) {
    return serialized.conversationText;
  }

  return `${serialized.conversationText}\n\n[Conversation truncated — only the most recent portion is shown]`;
};

const appendTelemetryEntry = (pi: ExtensionAPI, entry: GenerateAttempt) => {
  pi.appendEntry('session-index:index', entry);
};

const statusController = createStatusController(sessionIndexConfig);
const warnedInvalidMetaSessions = new Set<string>();

const runIndexing = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  force: boolean
): Promise<void> => {
  const debug = createDebugLogger();

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) {
    return;
  }

  const sessionId = ctx.sessionManager.getSessionId();
  const metaResult = await readMetaFile(sessionId);
  const existingMeta = metaResult.meta;
  const branch = ctx.sessionManager.getBranch();

  if (metaResult.warning && !warnedInvalidMetaSessions.has(sessionId)) {
    warnedInvalidMetaSessions.add(sessionId);
    await debug.log(sessionId, `Warning: ${metaResult.warning}`);
    ctx.ui.notify(
      'Session-index metadata file is invalid and will be regenerated on next successful index.',
      'warning'
    );
  }

  if (!sessionIndexConfigLoadResult.valid) {
    if (force) {
      statusController.setStatus(
        ctx,
        'error',
        '❌ index failed: invalid session-index config',
        true
      );
    }
    return;
  }

  const modelAvailability = await resolveTextModelAvailability(
    ctx,
    sessionIndexConfig.modelKeys
  );
  const configuredModel = modelAvailability.selected;
  if (!configuredModel) {
    if (force) {
      statusController.setStatus(
        ctx,
        'error',
        '❌ index failed: configured model unavailable',
        true
      );
    }
    return;
  }

  if (!force) {
    const newUserMessages = countNewUserMessages(
      branch,
      existingMeta?.lastIndexedLeafId
    );

    if (newUserMessages < sessionIndexConfig.minNewUserMessages) {
      return;
    }
  }

  try {
    const conversationText = serializeConversationForIndexing(branch);

    if (!conversationText.trim()) {
      statusController.setStatus(
        ctx,
        'error',
        '❌ index failed: no user/assistant conversation to index',
        true
      );
      await debug.log(sessionId, 'Failed: empty user/assistant conversation');
      return;
    }

    const modelName = `${configuredModel.model.provider}/${configuredModel.model.id}`;
    await debug.log(
      sessionId,
      `Indexing with ${modelName} (sessionFile: ${sessionFile})`
    );

    const generated = await generateSessionMeta({
      conversationText,
      sessionId,
      model: configuredModel.model,
      apiKey: configuredModel.apiKey,
      onStatus: message =>
        statusController.setStatus(ctx, 'dim', message, false),
      onAttempt: attempt => appendTelemetryEntry(pi, attempt),
    });

    await debug.log(
      sessionId,
      `Success with ${modelName} tokens=${generated.usage.totalTokens} cost=$${generated.usage.cost.total}`
    );

    const now = new Date().toISOString();
    const header = ctx.sessionManager.getHeader();
    const leafId = ctx.sessionManager.getLeafId() ?? '';

    const meta: MetaFile = {
      schemaVersion: 1,
      sessionId,
      sessionFile,
      parentSessionFile: header?.parentSession,
      name: generated.meta.name,
      description: generated.meta.description,
      summary: generated.meta.summary,
      tags: generated.meta.tags,
      cwd: ctx.cwd,
      createdAt: existingMeta?.createdAt ?? now,
      updatedAt: now,
      model: generated.model,
      lastIndexedLeafId: leafId,
    };

    await writeMetaFileAtomic(sessionId, meta);
    warnedInvalidMetaSessions.delete(sessionId);
    pi.setSessionName(meta.name);

    statusController.setStatus(
      ctx,
      'success',
      `✅ session indexed ($${formatUsdCost(generated.usage.cost.total)})`,
      true
    );
  } catch (error) {
    const message = toErrorMessage(error, 'Unknown indexing error');
    await debug.log(sessionId, `Failed: ${serializeError(error)}`);
    statusController.setStatus(
      ctx,
      'error',
      `❌ index failed: ${message}`,
      true
    );
  }
};

const registerSessionIndexCommand = (
  pi: ExtensionAPI,
  runForcedIndexing: (ctx: ExtensionCommandContext) => Promise<void>
) => {
  pi.registerCommand(sessionIndexConfig.commandName, {
    description: 'Force regenerate session metadata',
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      await runForcedIndexing(ctx);
    },
  });
};

const setupSessionIndexExtension = (pi: ExtensionAPI) => {
  let indexing = false;

  const runIndexingWithLock = async (
    ctx: ExtensionContext,
    force: boolean
  ): Promise<void> => {
    if (indexing) {
      if (force) {
        ctx.ui.notify('Session indexing already in progress', 'warning');
      }
      return;
    }

    indexing = true;
    try {
      await runIndexing(pi, ctx, force);
    } finally {
      indexing = false;
    }
  };

  registerSessionIndexCommand(pi, async ctx => {
    await runIndexingWithLock(ctx, true);
  });

  pi.on('session_start', async (_event, ctx) => {
    if (!sessionIndexConfigLoadResult.valid) {
      notifyInvalidConfig(ctx, {
        featureName: 'Session indexing',
        configPath: sessionIndexConfigLoadResult.path,
        errors: sessionIndexConfigLoadResult.errors,
      });
      return;
    }

    const modelAvailability = await resolveTextModelAvailability(
      ctx,
      sessionIndexConfig.modelKeys
    );
    if (modelAvailability.selected) {
      return;
    }

    notifyMissingModels(ctx, {
      featureName: 'Session indexing',
      missingModelKeys: modelAvailability.missingModelKeys,
    });
  });

  pi.on('agent_end', async (_event, ctx) => {
    await runIndexingWithLock(ctx, false);
  });
};

export default setupSessionIndexExtension;
