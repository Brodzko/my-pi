import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import type { Usage } from '@mariozechner/pi-ai';
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
import { generateHandoffSummary } from './generate';
import { composeHandoffPrefill } from './message';

const sessionHandoffConfig = sessionHandoffConfigLoadResult.config;
const statusController = createStatusController(sessionHandoffConfig);

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
) => {
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

const runHandoff = async (
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HandoffState,
  optionalInstruction: string
): Promise<void> => {
  if (!sessionHandoffConfigLoadResult.valid) {
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
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff disabled in session-handoff config',
      true
    );

    return;
  }

  const sourceSessionId = ctx.sessionManager.getSessionId();
  const sourceSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
  const entries = ctx.sessionManager.getBranch();
  const payload = buildHandoffContextPayload(
    entries,
    sessionHandoffConfig.maxBytes
  );

  if (!payload.conversationText.trim()) {
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: no user/assistant conversation to summarize',
      true
    );

    return;
  }

  const modelAvailability = await resolveTextModelAvailability(
    ctx,
    sessionHandoffConfig.modelKeys
  );
  const configuredModel = modelAvailability.selected;

  if (!configuredModel) {
    statusController.setStatus(
      ctx,
      'error',
      '❌ handoff failed: configured model unavailable',
      true
    );

    return;
  }

  const startedAt = Date.now();

  try {
    const generated = await generateHandoffSummary({
      model: configuredModel.model,
      apiKey: configuredModel.apiKey,
      context: payload,
      cwd: ctx.cwd,
      onStatus: message =>
        statusController.setStatus(ctx, 'dim', message, false),
      onAttempt: attempt => {
        pi.appendEntry('session-handoff:attempt', {
          sourceSessionId,
          sourceSessionFile,
          ...attempt,
        });
      },
    });

    const prefill = composeHandoffPrefill(
      generated.handoffMarkdown,
      optionalInstruction
    );

    const newSessionResult = await ctx.newSession({
      parentSession: sourceSessionFile,
    });

    if (newSessionResult.cancelled) {
      statusController.setStatus(ctx, 'error', '❌ handoff cancelled', true);
      return;
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

    statusController.setStatus(
      ctx,
      'success',
      `✅ handoff ready in new session ($${formatUsdCost(generated.usage.cost.total)})`,
      true
    );
  } catch (error) {
    const message = toErrorMessage(error, 'Unknown handoff error');

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
