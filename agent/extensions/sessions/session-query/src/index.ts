import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
  notifyInvalidConfig,
  notifyMissingModels,
} from '../../shared/feedback';
import { resolveTextModelAvailability } from '../../shared/model-availability';
import { querySessionConfigLoadResult } from './config';
import { registerQuerySessionTool } from './query-session';

const querySessionConfig = querySessionConfigLoadResult.config;

type QuerySessionExtensionState = {
  callCounter: {
    count: number;
  };
  warnedInvalidConfig: boolean;
  warnedMissingModel: boolean;
};

const createInitialState = (): QuerySessionExtensionState => ({
  callCounter: {
    count: 0,
  },
  warnedInvalidConfig: false,
  warnedMissingModel: false,
});

const notifyInvalidConfigOnce = (
  ctx: ExtensionContext,
  state: QuerySessionExtensionState
) => {
  if (state.warnedInvalidConfig) {
    return;
  }

  state.warnedInvalidConfig = true;

  notifyInvalidConfig(ctx, {
    featureName: 'query_session',
    configPath: querySessionConfigLoadResult.path,
    errors: querySessionConfigLoadResult.errors,
  });
};

const refreshOperationalState = async (
  ctx: ExtensionContext,
  state: QuerySessionExtensionState,
  notifyOnMissingModel: boolean
) => {
  if (!querySessionConfig.enabled || !querySessionConfigLoadResult.valid) {
    if (!querySessionConfigLoadResult.valid) {
      notifyInvalidConfigOnce(ctx, state);
    }

    return;
  }

  const modelAvailability = await resolveTextModelAvailability(
    ctx,
    querySessionConfig.modelKeys
  );

  if (
    !notifyOnMissingModel ||
    modelAvailability.selected ||
    state.warnedMissingModel
  ) {
    return;
  }

  state.warnedMissingModel = true;

  notifyMissingModels(ctx, {
    featureName: 'query_session',
    missingModelKeys: modelAvailability.missingModelKeys,
  });
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
};

export default setupQuerySessionExtension;
