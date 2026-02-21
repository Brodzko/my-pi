import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { querySessionConfigLoadResult } from './config';
import { resolveQueryModelAvailability } from './query-generate';
import { registerQuerySessionTool } from './query-session';

const querySessionConfig = querySessionConfigLoadResult.config;

const QUERY_SESSION_AGENT_INSTRUCTION =
  'If the user asks about decisions or details from another session (or references @@...), prefer using query_session once instead of guessing. If query_session returns low confidence or missing evidence, clearly communicate uncertainty.';

type QuerySessionExtensionState = {
  queryToolOperational: boolean;
  callCounter: {
    count: number;
  };
  warnedInvalidConfig: boolean;
  warnedMissingModel: boolean;
};

const createInitialState = (): QuerySessionExtensionState => ({
  queryToolOperational: false,
  callCounter: {
    count: 0,
  },
  warnedInvalidConfig: false,
  warnedMissingModel: false,
});

const notifyInvalidConfig = (
  ctx: ExtensionContext,
  state: QuerySessionExtensionState
) => {
  if (state.warnedInvalidConfig) {
    return;
  }

  state.warnedInvalidConfig = true;

  const formattedErrors = querySessionConfigLoadResult.errors
    .map(error => `• ${error}`)
    .join('\n');

  ctx.ui.notify(
    `query_session disabled. Invalid config at ${querySessionConfigLoadResult.path}\n${formattedErrors}`,
    'warning'
  );
};

const refreshOperationalState = async (
  ctx: ExtensionContext,
  state: QuerySessionExtensionState,
  notifyOnMissingModel: boolean
) => {
  if (!querySessionConfig.enabled || !querySessionConfigLoadResult.valid) {
    state.queryToolOperational = false;

    if (!querySessionConfigLoadResult.valid) {
      notifyInvalidConfig(ctx, state);
    }

    return;
  }

  const modelAvailability = await resolveQueryModelAvailability(
    ctx,
    querySessionConfig.modelKeys
  );

  state.queryToolOperational = Boolean(modelAvailability.selected);

  if (
    !notifyOnMissingModel ||
    modelAvailability.selected ||
    state.warnedMissingModel
  ) {
    return;
  }

  state.warnedMissingModel = true;
  ctx.ui.notify(
    `query_session disabled. Missing configured model(s): ${modelAvailability.missingModelKeys.join(', ')}`,
    'warning'
  );
};

const setupQuerySessionExtension = (pi: ExtensionAPI) => {
  const state = createInitialState();

  if (querySessionConfigLoadResult.valid && querySessionConfig.enabled) {
    registerQuerySessionTool(pi, querySessionConfig, state.callCounter);
  }

  pi.on('session_start', async (_event, ctx) => {
    await refreshOperationalState(ctx, state, true);
  });

  pi.on('session_switch', async (_event, ctx) => {
    await refreshOperationalState(ctx, state, true);
  });

  pi.on('model_select', async (_event, ctx) => {
    await refreshOperationalState(ctx, state, false);
  });

  pi.on('agent_start', () => {
    state.callCounter.count = 0;
  });

  pi.on('before_agent_start', event => {
    if (!state.queryToolOperational) {
      return undefined;
    }

    if (event.systemPrompt.includes(QUERY_SESSION_AGENT_INSTRUCTION)) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${QUERY_SESSION_AGENT_INSTRUCTION}`,
    };
  });
};

export default setupQuerySessionExtension;
