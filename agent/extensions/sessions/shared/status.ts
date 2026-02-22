import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

export type StatusTone = 'dim' | 'success' | 'error';

export type StatusConfig = {
  statusKey: string;
  notificationAutoClearMs: number;
};

export const createStatusController = (config: StatusConfig) => {
  let clearStatusTimeout: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    if (!clearStatusTimeout) {
      return;
    }

    clearTimeout(clearStatusTimeout);
    clearStatusTimeout = undefined;
  };

  return {
    setStatus: (
      ctx: ExtensionContext,
      tone: StatusTone,
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
    },
  };
};

export const createStatusSetter = (
  ctx: ExtensionContext,
  config: StatusConfig
) => {
  const controller = createStatusController(config);

  return {
    setStatus: (tone: StatusTone, message: string, autoClear: boolean) => {
      controller.setStatus(ctx, tone, message, autoClear);
    },
  };
};
