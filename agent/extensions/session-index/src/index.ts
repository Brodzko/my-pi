import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';
import { sessionIndexConfigLoadResult } from './config';
import { createDebugLogger, serializeError } from './debug-log';
import { type GenerateAttempt, generateSessionMeta } from './generate';
import { type MetaFile, readMetaFile, writeMetaFileAtomic } from './meta';
import { serializeConversationForIndexing } from './serialize';

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

const appendTelemetryEntry = (pi: ExtensionAPI, entry: GenerateAttempt) => {
  pi.appendEntry('session-index:index', entry);
};

const formatCost = (totalCost: number): string =>
  totalCost >= 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(6);

const isTextModel = (model: Model<Api>): boolean =>
  model.input.includes('text');

type ConfiguredModel = {
  model: Model<Api>;
  apiKey?: string;
};

type ConfiguredModelAvailability = {
  selected: ConfiguredModel | undefined;
  missingModelKeys: string[];
};

const resolveConfiguredModelAvailability = async (
  ctx: ExtensionContext
): Promise<ConfiguredModelAvailability> => {
  const availableModels = ctx.modelRegistry.getAvailable().filter(isTextModel);
  const modelsByKey = new Map(
    availableModels.map(model => [`${model.provider}/${model.id}`, model])
  );

  const missingModelKeys = sessionIndexConfig.modelKeys.filter(
    modelKey => !modelsByKey.has(modelKey)
  );

  const selectedKey = sessionIndexConfig.modelKeys.find(modelKey =>
    modelsByKey.has(modelKey)
  );

  if (!selectedKey) {
    return {
      selected: undefined,
      missingModelKeys,
    };
  }

  const selectedModel = modelsByKey.get(selectedKey);
  if (!selectedModel) {
    return {
      selected: undefined,
      missingModelKeys,
    };
  }

  return {
    selected: {
      model: selectedModel,
      apiKey: await ctx.modelRegistry.getApiKey(selectedModel),
    },
    missingModelKeys,
  };
};

let clearStatusTimeout: ReturnType<typeof setTimeout> | undefined;
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

  const setStatus = (
    status: string,
    tone: 'dim' | 'success' | 'error' = 'dim',
    autoClear = false
  ) => {
    if (clearStatusTimeout) {
      clearTimeout(clearStatusTimeout);
      clearStatusTimeout = undefined;
    }

    ctx.ui.setStatus(
      sessionIndexConfig.statusKey,
      ctx.ui.theme.fg(tone, status)
    );

    if (autoClear) {
      clearStatusTimeout = setTimeout(() => {
        ctx.ui.setStatus(sessionIndexConfig.statusKey, undefined);
        clearStatusTimeout = undefined;
      }, sessionIndexConfig.notificationAutoClearMs);
    }
  };

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
      setStatus('❌ index failed: invalid session-index config', 'error', true);
    }
    return;
  }

  const modelAvailability = await resolveConfiguredModelAvailability(ctx);
  const configuredModel = modelAvailability.selected;
  if (!configuredModel) {
    if (force) {
      setStatus('❌ index failed: configured model unavailable', 'error', true);
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
      setStatus(
        '❌ index failed: no user/assistant conversation to index',
        'error',
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
      onStatus: message => setStatus(message, 'dim'),
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

    setStatus(
      `✅ session indexed ($${formatCost(generated.usage.cost.total)})`,
      'success',
      true
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown indexing error';
    await debug.log(sessionId, `Failed: ${serializeError(error)}`);
    setStatus(`❌ index failed: ${message}`, 'error', true);
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
      const formattedErrors = sessionIndexConfigLoadResult.errors
        .map(error => `• ${error}`)
        .join('\n');

      ctx.ui.notify(
        `Session indexing disabled. Invalid config at ${sessionIndexConfigLoadResult.path}\n${formattedErrors}`,
        'warning'
      );
      return;
    }

    const modelAvailability = await resolveConfiguredModelAvailability(ctx);
    if (modelAvailability.selected) {
      return;
    }

    ctx.ui.notify(
      `Session indexing disabled. Missing configured model(s): ${modelAvailability.missingModelKeys.join(', ')}`,
      'warning'
    );
  });

  pi.on('agent_end', async (_event, ctx) => {
    await runIndexingWithLock(ctx, false);
  });
};

export default setupSessionIndexExtension;
