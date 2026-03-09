import type {
  ExtensionContext,
  ThemeColor,
} from '@mariozechner/pi-coding-agent';
import type { ReadonlyFooterDataProvider } from '@mariozechner/pi-coding-agent';
import type { TUI } from '@mariozechner/pi-tui';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import type { StatuslineEditor, EditorInfo } from './editor';
import { formatTokens } from './format';
import { PROGRESS_WIDTH, renderProgressBar } from './progress-bar';
import {
  renderSubscriptionLines,
  modelProviderToUsageProvider,
} from './subscription-footer';
import {
  fetchSubscriptionUsageEntries,
  type ProviderId,
  type SubscriptionUsageEntry,
} from './subscription-limits';

type ThemeFg = { fg: (color: ThemeColor, text: string) => string };

type FooterDeps = {
  getEditor: () => StatuslineEditor | null;
  ctx: ExtensionContext;
  buildEditorInfo: (ctx: ExtensionContext) => EditorInfo;
  isTurnOngoing: () => boolean;
};

const SUBSCRIPTION_COOLDOWN_MS = 2 * 60_000;
const SUBSCRIPTION_MAX_BACKOFF_MS = 15 * 60_000;
const TURN_SPINNER_INTERVAL_MS = 100;
const TURN_SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;

export const createFooter = (
  tui: TUI,
  theme: ThemeFg,
  footerData: ReadonlyFooterDataProvider,
  deps: FooterDeps,
  onBranchChange: () => Promise<void>
) => {
  const unsub = footerData.onBranchChange(async () => {
    await onBranchChange();
    tui.requestRender();
  });

  let lastThinking = '';
  let subscriptionEntries: SubscriptionUsageEntry[] | null = null;
  let lastSubscriptionFetchAt = 0;
  let isSubscriptionLoading = false;
  let subscriptionCooldownMs = SUBSCRIPTION_COOLDOWN_MS;
  let lastActiveUsageProvider: ProviderId | null = null;
  let turnSpinnerTimer: ReturnType<typeof setInterval> | null = null;

  const stopTurnSpinner = () => {
    if (!turnSpinnerTimer) return;
    clearInterval(turnSpinnerTimer);
    turnSpinnerTimer = null;
  };

  const ensureTurnSpinner = () => {
    if (!deps.isTurnOngoing()) {
      stopTurnSpinner();
      return;
    }

    if (turnSpinnerTimer) return;
    turnSpinnerTimer = setInterval(() => {
      tui.requestRender();
    }, TURN_SPINNER_INTERVAL_MS);
  };

  const refreshSubscriptionUsage = async (force = false) => {
    if (isSubscriptionLoading) return;

    if (!force && Date.now() - lastSubscriptionFetchAt < subscriptionCooldownMs)
      return;

    isSubscriptionLoading = true;

    try {
      const activeUsageProvider = modelProviderToUsageProvider(
        deps.ctx.model?.provider
      );
      if (!activeUsageProvider) {
        subscriptionEntries = null;
        lastActiveUsageProvider = null;
        lastSubscriptionFetchAt = Date.now();
        subscriptionCooldownMs = SUBSCRIPTION_COOLDOWN_MS;
        tui.requestRender();
        return;
      }

      const entries = await fetchSubscriptionUsageEntries(
        deps.ctx,
        activeUsageProvider
      );

      const hasUsableData = entries?.some(e => e.usage !== null) ?? false;

      if (hasUsableData) {
        subscriptionCooldownMs = SUBSCRIPTION_COOLDOWN_MS;
      } else {
        subscriptionCooldownMs = Math.min(
          subscriptionCooldownMs * 2,
          SUBSCRIPTION_MAX_BACKOFF_MS
        );
      }

      subscriptionEntries = entries;
      lastActiveUsageProvider = activeUsageProvider;
      lastSubscriptionFetchAt = Date.now();
      tui.requestRender();
    } finally {
      isSubscriptionLoading = false;
    }
  };

  // Initial fetch on session start
  void refreshSubscriptionUsage(true);

  return {
    dispose: () => {
      stopTurnSpinner();
      unsub();
    },
    invalidate() {},
    refreshUsage: () => void refreshSubscriptionUsage(),
    render(width: number): string[] {
      const info = deps.buildEditorInfo(deps.ctx);
      const editor = deps.getEditor();
      if (editor) {
        editor.setBorderTheme(theme);
        editor.updateInfo(info);
      }

      if (info.thinking !== lastThinking) {
        lastThinking = info.thinking;
        tui.requestRender();
      }

      const activeUsageProvider = modelProviderToUsageProvider(
        deps.ctx.model?.provider
      );
      const providerChanged = activeUsageProvider !== lastActiveUsageProvider;
      if (providerChanged && !isSubscriptionLoading) {
        subscriptionEntries = null;
        lastSubscriptionFetchAt = 0;
        subscriptionCooldownMs = SUBSCRIPTION_COOLDOWN_MS;
        void refreshSubscriptionUsage(true);
      }

      ensureTurnSpinner();

      const usage = deps.ctx.getContextUsage();
      const statuses = renderStatuses(footerData.getExtensionStatuses(), theme);
      const turnSpinner = deps.isTurnOngoing()
        ? theme.fg(
            'warning',
            TURN_SPINNER_FRAMES[
              Math.floor(Date.now() / TURN_SPINNER_INTERVAL_MS) %
                TURN_SPINNER_FRAMES.length
            ]
          )
        : '';
      const primaryLine =
        !usage || usage.percent === null
          ? renderNoUsage(statuses, turnSpinner, theme, width)
          : renderWithUsage(usage, statuses, turnSpinner, theme, width);

      return [
        primaryLine,
        ...renderSubscriptionLines(
          subscriptionEntries,
          isSubscriptionLoading,
          theme,
          width
        ),
      ];
    },
  };
};

const renderStatuses = (
  statuses: ReadonlyMap<string, string>,
  theme: ThemeFg
): string =>
  Array.from(statuses.values())
    .map(text => theme.fg('dim', text))
    .join(theme.fg('dim', ' │ '));

const renderNoUsage = (
  statusStr: string,
  turnSpinner: string,
  theme: ThemeFg,
  width: number
): string => {
  const left = theme.fg('dim', 'Ready');
  const right = [statusStr, turnSpinner].filter(Boolean).join(' ');
  if (!right) return truncateToWidth(left, width);

  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(`${left}${' '.repeat(gap)}${right}`, width);
};

const renderWithUsage = (
  usage: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  },
  statusStr: string,
  turnSpinner: string,
  theme: ThemeFg,
  width: number
): string => {
  const percent = Math.min(100, Math.round(usage.percent!));
  const bar = renderProgressBar(percent, PROGRESS_WIDTH, theme);
  const label = theme.fg(
    'dim',
    ` ${percent}%/${formatTokens(usage.contextWindow)}`
  );
  const left = `${bar}${label}`;

  const right = [statusStr, turnSpinner].filter(Boolean).join(' ');
  if (!right) return truncateToWidth(left, width);

  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(`${left}${' '.repeat(gap)}${right}`, width);
};
