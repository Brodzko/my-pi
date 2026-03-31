import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import type { Api, Model, Usage } from '@mariozechner/pi-ai';
import { readFile } from 'node:fs/promises';
import {
  formatUsdCost,
  notifyInvalidConfig,
  notifyMissingModels,
  toErrorMessage,
} from '../../shared/feedback';
import { resolveTextModelAvailability } from '../../shared/model-availability';
import { createStatusController } from '../../shared/status';
import { buildHandoffContextPayload } from './context';
import { sessionHandoffConfigLoadResult } from './config';
import { createDebugLogger, serializeError } from './debug-log';
import { generateHandoffSummary } from './generate';
import { composeHandoffPrefill } from './message';

const sessionHandoffConfig = sessionHandoffConfigLoadResult.config;
const statusController = createStatusController(sessionHandoffConfig);

type SettingsFile = {
  enabledModels?: string[];
};

const settingsJsonPath = new URL('../../../../settings.json', import.meta.url);

const loadEnabledModelPatterns = async (): Promise<string[] | undefined> => {
  try {
    const raw = await readFile(settingsJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as SettingsFile;

    return parsed.enabledModels;
  } catch {
    return undefined;
  }
};

type HandoffTelemetryEntry = {
  success: boolean;
  timestamp: string;
  sourceSessionId: string;
  sourceSessionFile?: string;
  model?: string;
  usage?: Usage;
  serializedBytes: number;
  truncated: boolean;
  touchedFilesCount: number;
  optionalInstructionProvided: boolean;
  latencyMs: number;
  error?: string;
};

const appendTelemetryEntry = (pi: ExtensionAPI, entry: HandoffTelemetryEntry) =>
  pi.appendEntry('session-handoff:generate', entry);

type HandoffState = {
  warnedInvalidConfig: boolean;
  warnedMissingModel: boolean;
  running: boolean;
};

const createState = (): HandoffState => ({
  warnedInvalidConfig: false,
  warnedMissingModel: false,
  running: false,
});

const notifyInvalidConfigOnce = (
  ctx: ExtensionContext,
  state: HandoffState
): void => {
  if (state.warnedInvalidConfig) {
    return;
  }

  state.warnedInvalidConfig = true;

  notifyInvalidConfig(ctx, {
    featureName: 'Session handoff',
    configPath: sessionHandoffConfigLoadResult.path,
    errors: sessionHandoffConfigLoadResult.errors,
  });
};

const checkModelAvailability = async (
  ctx: ExtensionContext,
  state: HandoffState
): Promise<void> => {
  if (
    !sessionHandoffConfig.enabled ||
    !sessionHandoffConfigLoadResult.valid ||
    state.warnedMissingModel
  ) {
    return;
  }

  const availability = await resolveTextModelAvailability(
    ctx,
    sessionHandoffConfig.modelKeys
  );
  if (availability.selected) {
    return;
  }

  state.warnedMissingModel = true;

  notifyMissingModels(ctx, {
    featureName: 'Session handoff',
    missingModelKeys: availability.missingModelKeys,
  });
};

const isTextModel = (model: Model<Api>): boolean =>
  model.input.includes('text');

type SelectableTargetModel = {
  label: string;
  model: Model<Api>;
};

const THINKING_LEVEL_SUFFIX = ['off', 'low', 'medium', 'high', 'max'] as const;

const stripThinkingLevelSuffix = (pattern: string): string => {
  const parts = pattern.split(':');
  if (parts.length < 2) {
    return pattern;
  }

  const suffix = parts.at(-1)?.toLowerCase();
  const hasThinkingLevelSuffix = THINKING_LEVEL_SUFFIX.some(
    level => level === suffix
  );

  if (!suffix || !hasThinkingLevelSuffix) {
    return pattern;
  }

  return parts.slice(0, -1).join(':');
};

const toGlobRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = `^${escaped.replace(/\*/g, '.*')}$`;

  return new RegExp(regexSource, 'i');
};

const matchesModelPattern = (
  model: Model<Api>,
  rawPattern: string
): boolean => {
  const pattern = stripThinkingLevelSuffix(rawPattern).trim();
  if (!pattern) {
    return false;
  }

  const providerAndId = `${model.provider}/${model.id}`;
  const hasWildcard = pattern.includes('*');

  if (hasWildcard) {
    const patternRegex = toGlobRegex(pattern);

    return (
      patternRegex.test(providerAndId) ||
      patternRegex.test(model.id) ||
      patternRegex.test(model.name)
    );
  }

  const normalizedPattern = pattern.toLowerCase();

  return (
    providerAndId.toLowerCase() === normalizedPattern ||
    model.id.toLowerCase() === normalizedPattern ||
    model.name.toLowerCase().includes(normalizedPattern)
  );
};

const resolveScopedModelsFromPatterns = (
  models: Model<Api>[],
  patterns: string[]
): Model<Api>[] => {
  const scopedModels: Model<Api>[] = [];

  for (const pattern of patterns) {
    const matchingModels = models.filter(model =>
      matchesModelPattern(model, pattern)
    );

    for (const model of matchingModels) {
      const alreadyIncluded = scopedModels.some(
        scopedModel =>
          scopedModel.provider === model.provider && scopedModel.id === model.id
      );

      if (!alreadyIncluded) {
        scopedModels.push(model);
      }
    }
  }

  return scopedModels;
};

const getSelectableTargetModels = async (
  ctx: ExtensionCommandContext
): Promise<SelectableTargetModel[]> => {
  const availableModels = ctx.modelRegistry.getAvailable();
  const enabledPatterns = await loadEnabledModelPatterns();

  const models =
    enabledPatterns && enabledPatterns.length > 0
      ? resolveScopedModelsFromPatterns(availableModels, enabledPatterns)
      : availableModels;

  return models.filter(isTextModel).map(model => ({
    label: `${model.provider}/${model.id}`,
    model,
  }));
};

const chooseTargetSessionModel = async (
  ctx: ExtensionCommandContext
): Promise<Model<Api> | undefined> => {
  const selectableModels = await getSelectableTargetModels(ctx);
  if (selectableModels.length === 0) {
    return undefined;
  }

  if (!ctx.hasUI || selectableModels.length === 1) {
    return ctx.model ?? selectableModels[0]?.model;
  }

  const selectedLabel = await ctx.ui.select(
    'Choose model for new session',
    selectableModels.map(model => model.label)
  );

  if (!selectedLabel) {
    statusController.setStatus(ctx, 'error', '❌ handoff cancelled', true);
    return undefined;
  }

  return selectableModels.find(model => model.label === selectedLabel)?.model;
};

const collectOptionalInstruction = async (
  ctx: ExtensionCommandContext,
  initialInstruction: string
): Promise<string | undefined> => {
  if (!ctx.hasUI) {
    return initialInstruction;
  }

  const instruction = await ctx.ui.editor(
    'Additional handoff instructions (optional)',
    initialInstruction
  );

  if (instruction === undefined) {
    statusController.setStatus(ctx, 'error', '❌ handoff cancelled', true);
    return undefined;
  }

  return instruction;
};

const runHandoff = async (
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HandoffState,
  initialInstruction: string
): Promise<void> => {
  const sourceSessionId = ctx.sessionManager.getSessionId();
  const sourceSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
  const debug = createDebugLogger(ctx.cwd);

  await debug.log(
    sourceSessionId,
    `Started handoff (sessionFile: ${sourceSessionFile ?? 'none'}, initialInstructionChars: ${initialInstruction.length})`
  );

  if (!sessionHandoffConfigLoadResult.valid) {
    await debug.log(sourceSessionId, 'Failed: invalid session-handoff config');
    notifyInvalidConfigOnce(ctx, state);

    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: invalid session-handoff config',
      true
    );

    return;
  }

  if (!sessionHandoffConfig.enabled) {
    await debug.log(sourceSessionId, 'Failed: handoff disabled in config');
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff disabled in session-handoff config',
      true
    );

    return;
  }

  const entries = ctx.sessionManager.getBranch();
  const payload = buildHandoffContextPayload(
    entries,
    sessionHandoffConfig.maxBytes
  );

  await debug.log(
    sourceSessionId,
    `Built payload (entries: ${entries.length}, serializedBytes: ${payload.serializedBytes}, truncated: ${payload.truncated}, touchedFiles: ${payload.touchedFiles.length})`
  );

  if (!payload.conversationText.trim()) {
    await debug.log(
      sourceSessionId,
      'Failed: no user/assistant conversation to summarize'
    );
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: no user/assistant conversation to summarize',
      true
    );

    return;
  }

  const targetSessionModel = await chooseTargetSessionModel(ctx);
  if (!targetSessionModel) {
    await debug.log(
      sourceSessionId,
      'Failed: no selectable text model available or model selection cancelled'
    );
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: no selectable text model available',
      true
    );

    return;
  }

  await debug.log(
    sourceSessionId,
    `Selected target session model ${targetSessionModel.provider}/${targetSessionModel.id}`
  );

  const optionalInstruction = await collectOptionalInstruction(
    ctx,
    initialInstruction
  );
  if (optionalInstruction === undefined) {
    await debug.log(sourceSessionId, 'Cancelled: optional instruction editor');
    return;
  }

  await debug.log(
    sourceSessionId,
    `Collected optional instruction (chars: ${optionalInstruction.length})`
  );

  const modelAvailability = await resolveTextModelAvailability(
    ctx,
    sessionHandoffConfig.modelKeys
  );
  const configuredModel = modelAvailability.selected;

  if (!configuredModel) {
    await debug.log(
      sourceSessionId,
      `Failed: configured model unavailable (${sessionHandoffConfig.modelKeys.join(', ')})`
    );
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: configured model unavailable',
      true
    );

    return;
  }

  const startedAt = Date.now();

  await debug.log(
    sourceSessionId,
    `Generating handoff with ${configuredModel.model.provider}/${configuredModel.model.id}`
  );

  try {
    const generated = await generateHandoffSummary({
      model: configuredModel.model,
      apiKey: configuredModel.apiKey,
      headers: configuredModel.headers,
      context: payload,
      cwd: ctx.cwd,
      onStatus: message =>
        statusController.setStatus(ctx, 'dim', message, false),
      onAttempt: attempt => {
        void debug.log(
          sourceSessionId,
          attempt.success
            ? `Generation attempt succeeded with ${attempt.model}`
            : `Generation attempt failed with ${attempt.model}: ${attempt.error ?? 'unknown error'}`
        );
        pi.appendEntry('session-handoff:attempt', {
          sourceSessionId,
          sourceSessionFile,
          ...attempt,
        });
      },
    });

    await debug.log(
      sourceSessionId,
      `Generated handoff successfully with ${generated.model} tokens=${generated.usage.totalTokens} cost=$${generated.usage.cost.total}`
    );

    const prefill = composeHandoffPrefill(
      generated.handoffMarkdown,
      optionalInstruction,
      sourceSessionId
    );

    const newSessionResult = await ctx.newSession({
      parentSession: sourceSessionFile,
    });

    if (newSessionResult.cancelled) {
      await debug.log(sourceSessionId, 'Cancelled: newSession flow');
      statusController.setStatus(ctx, 'error', '❌ handoff cancelled', true);
      return;
    }

    await debug.log(sourceSessionId, 'Opened new session successfully');

    const modelSet = await pi.setModel(targetSessionModel);
    if (!modelSet) {
      await debug.log(
        sourceSessionId,
        `Warning: failed to activate target model ${targetSessionModel.provider}/${targetSessionModel.id} in new session`
      );
      ctx.ui.notify(
        `Could not activate ${targetSessionModel.provider}/${targetSessionModel.id} in new session`,
        'warning'
      );
    }

    ctx.ui.setEditorText(prefill);

    const latencyMs = Date.now() - startedAt;

    appendTelemetryEntry(pi, {
      success: true,
      timestamp: new Date().toISOString(),
      sourceSessionId,
      sourceSessionFile,
      model: generated.model,
      usage: generated.usage,
      serializedBytes: payload.serializedBytes,
      truncated: payload.truncated,
      touchedFilesCount: payload.touchedFiles.length,
      optionalInstructionProvided: optionalInstruction.trim().length > 0,
      latencyMs,
    });

    await debug.log(
      sourceSessionId,
      `Success: handoff ready in new session latencyMs=${latencyMs}`
    );

    statusController.setStatus(
      ctx,
      'success',
      `✅ handoff ready in new session ($${formatUsdCost(generated.usage.cost.total)})`,
      true
    );
  } catch (error) {
    const message = toErrorMessage(error, 'Unknown handoff error');

    await debug.log(sourceSessionId, `Failed: ${serializeError(error)}`);

    appendTelemetryEntry(pi, {
      success: false,
      timestamp: new Date().toISOString(),
      sourceSessionId,
      sourceSessionFile,
      serializedBytes: payload.serializedBytes,
      truncated: payload.truncated,
      touchedFilesCount: payload.touchedFiles.length,
      optionalInstructionProvided: optionalInstruction.trim().length > 0,
      latencyMs: Date.now() - startedAt,
      error: message,
    });

    statusController.setStatus(
      ctx,
      'error',
      `❌ handoff failed: ${message}`,
      true
    );
  }
};

const registerHandoffCommand = (pi: ExtensionAPI, state: HandoffState) => {
  pi.registerCommand(sessionHandoffConfig.commandName, {
    description:
      'Generate a handoff summary and open a new session with prefilled context',
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      if (state.running) {
        const debug = createDebugLogger(ctx.cwd);
        await debug.log(
          ctx.sessionManager.getSessionId(),
          'Skipped: handoff generation already in progress'
        );
        ctx.ui.notify('Handoff generation already in progress', 'warning');
        return;
      }

      state.running = true;

      try {
        await runHandoff(pi, ctx, state, args);
      } finally {
        state.running = false;
      }
    },
  });
};

export const setupSessionHandoffExtension = (pi: ExtensionAPI) => {
  const state = createState();

  registerHandoffCommand(pi, state);

  pi.on('session_start', async (_event, ctx) => {
    if (!sessionHandoffConfigLoadResult.valid) {
      notifyInvalidConfigOnce(ctx, state);
      return;
    }

    await checkModelAvailability(ctx, state);
  });

  pi.on('session_switch', async (_event, ctx) => {
    await checkModelAvailability(ctx, state);
  });
};

export default setupSessionHandoffExtension;
