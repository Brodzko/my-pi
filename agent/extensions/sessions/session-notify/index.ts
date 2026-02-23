import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';

type SessionNotifyConfig = {
  enabled: boolean;
  statusKey: string;
  notificationAutoClearMs: number;
  bellCount: number;
  showLoadedToast: boolean;
};

const config: SessionNotifyConfig = {
  enabled: true,
  statusKey: 'session-notify',
  notificationAutoClearMs: 4000,
  bellCount: 1,
  showLoadedToast: true,
};

type SessionNotifyState = {
  turnStartAtMs?: number;
  clearStatusTimeout?: ReturnType<typeof setTimeout>;
};

const clearStatusTimeout = (state: SessionNotifyState) => {
  if (!state.clearStatusTimeout) return;
  clearTimeout(state.clearStatusTimeout);
  state.clearStatusTimeout = undefined;
};

const formatElapsed = (elapsedMs: number): string => {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  if (elapsedMs < 60_000) return `${(elapsedMs / 1000).toFixed(1)}s`;

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = ((elapsedMs % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const playBell = () => {
  if (!process.stdout.writable) return;
  process.stdout.write('\x07'.repeat(config.bellCount));
};

const showDuration = (ctx: ExtensionContext, state: SessionNotifyState) => {
  if (!state.turnStartAtMs) return;

  const elapsedMs = Math.max(0, Date.now() - state.turnStartAtMs);
  const message = `turn complete in ${formatElapsed(elapsedMs)}`;

  ctx.ui.notify(message, 'info');
  ctx.ui.setStatus(config.statusKey, ctx.ui.theme.fg('dim', `🔔 ${message}`));

  clearStatusTimeout(state);
  if (config.notificationAutoClearMs > 0) {
    state.clearStatusTimeout = setTimeout(() => {
      ctx.ui.setStatus(config.statusKey, undefined);
      state.clearStatusTimeout = undefined;
    }, config.notificationAutoClearMs);
  }
};

export default function setupSessionNotify(pi: ExtensionAPI) {
  const state: SessionNotifyState = {};

  pi.registerCommand('session-notify-ping', {
    description: 'Verify session-notify extension is loaded',
    handler: async (_args, ctx) => {
      ctx.ui.notify('session-notify ping', 'info');
      ctx.ui.setWidget(
        'session-notify-debug',
        (_tui, theme) => ({
          render: () => [theme.fg('accent', 'session-notify is active')],
          invalidate: () => {},
        }),
        { placement: 'belowEditor' }
      );
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    if (config.showLoadedToast) {
      ctx.ui.notify('session-notify loaded', 'info');
    }
  });

  pi.on('agent_start', async () => {
    state.turnStartAtMs = Date.now();
  });

  pi.on('agent_end', async (_event, ctx) => {
    if (!config.enabled) return;
    playBell();
    showDuration(ctx, state);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearStatusTimeout(state);
    ctx.ui.setStatus(config.statusKey, undefined);
    ctx.ui.setWidget('session-notify-debug', undefined);
  });
}
