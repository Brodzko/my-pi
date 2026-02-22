import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { SessionReferenceConfig } from './config';

export const createStatusNotifier = (
  ctx: ExtensionContext,
  config: SessionReferenceConfig
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
