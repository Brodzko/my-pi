import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { notifyInvalidConfig } from '../../shared/feedback';
import { sessionNotifyConfigLoadResult } from './config';

const sessionNotifyConfig = sessionNotifyConfigLoadResult.config;

type SessionNotifyState = {
  warnedInvalidConfig: boolean;
  turnStartAtMs?: number;
  clearStatusTimeout?: ReturnType<typeof setTimeout>;
};

const createInitialState = (): SessionNotifyState => ({
  warnedInvalidConfig: false,
  turnStartAtMs: undefined,
  clearStatusTimeout: undefined,
});

const notifyInvalidConfigOnce = (
  ctx: ExtensionContext,
  state: SessionNotifyState
) => {
  if (state.warnedInvalidConfig) {
    return;
  }

  state.warnedInvalidConfig = true;

  notifyInvalidConfig(ctx, {
    featureName: 'session-notify',
    configPath: sessionNotifyConfigLoadResult.path,
    errors: sessionNotifyConfigLoadResult.errors,
  });
};

const clearStatusTimeout = (state: SessionNotifyState) => {
  if (!state.clearStatusTimeout) {
    return;
  }

  clearTimeout(state.clearStatusTimeout);
  state.clearStatusTimeout = undefined;
};

const formatElapsed = (elapsedMs: number): string => {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  if (elapsedMs < 60_000) {
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = ((elapsedMs % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const sanitizeOscText = (value: string): string =>
  value.replace(/[\x1b\x07;\\]/g, ' ').trim();

const playTerminalBell = () => {
  if (!process.stdout.writable) {
    return;
  }

  process.stdout.write('\x07'.repeat(sessionNotifyConfig.bellCount));
};

const playTerminalOscNotification = (title: string, body: string) => {
  if (!process.stdout.writable) {
    return;
  }

  const safeTitle = sanitizeOscText(title);
  const safeBody = sanitizeOscText(body);

  if (process.env.KITTY_WINDOW_ID) {
    process.stdout.write(`\x1b]99;i=1:d=0;${safeTitle}\x1b\\`);
    process.stdout.write(`\x1b]99;i=1:p=body;${safeBody}\x1b\\`);
    return;
  }

  process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
};

const playNotificationSound = (elapsedLabel: string) => {
  const title = 'Pi';
  const body = `turn complete in ${elapsedLabel}`;

  if (sessionNotifyConfig.soundMode === 'terminal-bell') {
    playTerminalBell();
    return;
  }

  if (sessionNotifyConfig.soundMode === 'terminal-osc') {
    playTerminalOscNotification(title, body);
    return;
  }

  playTerminalOscNotification(title, body);
  playTerminalBell();
};

const showTurnTiming = (
  ctx: ExtensionContext,
  state: SessionNotifyState
): string | undefined => {
  if (!state.turnStartAtMs) {
    return undefined;
  }

  const elapsedMs = Math.max(0, Date.now() - state.turnStartAtMs);
  const elapsedLabel = formatElapsed(elapsedMs);
  const message = `turn complete in ${elapsedLabel}`;

  ctx.ui.notify(message, 'info');
  ctx.ui.setStatus(
    sessionNotifyConfig.statusKey,
    ctx.ui.theme.fg('dim', `🔔 ${message}`)
  );

  clearStatusTimeout(state);

  if (sessionNotifyConfig.notificationAutoClearMs > 0) {
    state.clearStatusTimeout = setTimeout(() => {
      ctx.ui.setStatus(sessionNotifyConfig.statusKey, undefined);
      state.clearStatusTimeout = undefined;
    }, sessionNotifyConfig.notificationAutoClearMs);
  }

  return elapsedLabel;
};

export const setupSessionNotifyExtension = (pi: ExtensionAPI) => {
  const state = createInitialState();

  pi.on('session_start', async (_event, ctx) => {
    if (!sessionNotifyConfigLoadResult.valid) {
      notifyInvalidConfigOnce(ctx, state);
    }
  });

  pi.on('agent_start', async () => {
    state.turnStartAtMs = Date.now();
  });

  pi.on('agent_end', async (_event, ctx) => {
    if (!sessionNotifyConfig.enabled || !sessionNotifyConfigLoadResult.valid) {
      return;
    }

    const elapsedLabel = showTurnTiming(ctx, state);
    if (!elapsedLabel) {
      return;
    }

    playNotificationSound(elapsedLabel);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearStatusTimeout(state);
    ctx.ui.setStatus(sessionNotifyConfig.statusKey, undefined);
  });
};

export default setupSessionNotifyExtension;
