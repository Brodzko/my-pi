import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { QuerySessionConfig } from './types';

const formatCost = (costUsd: number): string =>
  costUsd >= 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(6);

export const createStatusNotifier = (
  ctx: ExtensionContext,
  config: QuerySessionConfig
) => {
  let clearStatusTimeout: ReturnType<typeof setTimeout> | undefined;
  const clearPending = () => {
    if (!clearStatusTimeout) {
      return;
    }

    clearTimeout(clearStatusTimeout);
    clearStatusTimeout = undefined;
  };

  const setStatus = (
    tone: 'dim' | 'success' | 'error',
    message: string,
    autoClear: boolean
  ) => {
    clearPending();
    ctx.ui.setStatus(config.statusKey, ctx.ui.theme.fg(tone, message));

    if (!autoClear) {
      return;
    }

    clearStatusTimeout = setTimeout(() => {
      ctx.ui.setStatus(config.statusKey, undefined);
      clearStatusTimeout = undefined;
    }, config.notificationAutoClearMs);
  };

  return {
    start: () => {
      setStatus('dim', 'querying another session...', false);
    },
    success: (costUsd: number) => {
      setStatus(
        'success',
        `query_session done ($${formatCost(costUsd)})`,
        true
      );
    },
    failure: (message: string) => {
      setStatus('error', `query_session failed: ${message}`, true);
    },
  };
};
