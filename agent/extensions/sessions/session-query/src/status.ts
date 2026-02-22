import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { formatUsdCost } from '../../shared/feedback';
import { createStatusSetter } from '../../shared/status';
import type { QuerySessionConfig } from './types';

export const createStatusNotifier = (
  ctx: ExtensionContext,
  config: QuerySessionConfig
) => {
  const { setStatus } = createStatusSetter(ctx, config);

  return {
    start: () => {
      setStatus('dim', 'querying another session...', false);
    },
    success: (costUsd: number) => {
      setStatus(
        'success',
        `query_session done ($${formatUsdCost(costUsd)})`,
        true
      );
    },
    failure: (message: string) => {
      setStatus('error', `query_session failed: ${message}`, true);
    },
  };
};
