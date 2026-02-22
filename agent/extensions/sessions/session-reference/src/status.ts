import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createStatusSetter } from '../../shared/status';
import type { SessionReferenceConfig } from './config';

export const createStatusNotifier = (
  ctx: ExtensionContext,
  config: SessionReferenceConfig
) => {
  const { setStatus } = createStatusSetter(ctx, config);

  return {
    report: (resolvedCount: number, failedCount: number) => {
      const resolvedMessage =
        resolvedCount > 0 ? `✅ resolved ${resolvedCount} reference(s)` : '';
      const failedMessage =
        failedCount > 0
          ? `⚠️ failed to resolve ${failedCount} reference(s)`
          : '';

      const message = [resolvedMessage, failedMessage]
        .filter(part => part.length > 0)
        .join(', ');

      if (!message) {
        return;
      }

      const tone: 'dim' | 'success' | 'error' =
        resolvedMessage && failedMessage
          ? 'dim'
          : resolvedMessage
            ? 'success'
            : 'error';

      setStatus(tone, message, true);
    },
  };
};
