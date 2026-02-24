import type { ExtensionContext, ThemeColor } from '@mariozechner/pi-coding-agent';
import type { ReadonlyFooterDataProvider } from '@mariozechner/pi-coding-agent';
import type { TUI } from '@mariozechner/pi-tui';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import type { StatuslineEditor, EditorInfo } from './editor';
import { formatTokens } from './format';
import { PROGRESS_WIDTH, renderProgressBar } from './progress-bar';
import { renderSubscriptionLines, modelProviderToUsageProvider } from './subscription-footer';
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
};

const subscriptionRefreshMs = 60_000;

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
  let lastActiveUsageProvider: ProviderId | null = null;

  const refreshSubscriptionSummary = async () => {
    if (isSubscriptionLoading) return;
    isSubscriptionLoading = true;

    try {
      const activeUsageProvider = modelProviderToUsageProvider(deps.ctx.model?.provider);
      if (!activeUsageProvider) {
        subscriptionEntries = null;
        lastActiveUsageProvider = null;
        lastSubscriptionFetchAt = Date.now();
        tui.requestRender();
        return;
      }

      subscriptionEntries = await fetchSubscriptionUsageEntries(
        deps.ctx,
        activeUsageProvider
      );
      lastActiveUsageProvider = activeUsageProvider;
      lastSubscriptionFetchAt = Date.now();
      tui.requestRender();
    } finally {
      isSubscriptionLoading = false;
    }
  };

  void refreshSubscriptionSummary();

  return {
    dispose: unsub,
    invalidate() {},
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

      const activeUsageProvider = modelProviderToUsageProvider(deps.ctx.model?.provider);
      const providerChanged = activeUsageProvider !== lastActiveUsageProvider;
      if (providerChanged && !isSubscriptionLoading) {
        subscriptionEntries = null;
        lastSubscriptionFetchAt = 0;
        void refreshSubscriptionSummary();
      }

      if (
        !isSubscriptionLoading &&
        Date.now() - lastSubscriptionFetchAt >= subscriptionRefreshMs
      ) {
        void refreshSubscriptionSummary();
      }

      const usage = deps.ctx.getContextUsage();
      const statuses = renderStatuses(footerData.getExtensionStatuses(), theme);
      const primaryLine =
        !usage || usage.percent === null
          ? renderNoUsage(statuses, theme, width)
          : renderWithUsage(usage, statuses, theme, width);

      return [
        primaryLine,
        ...renderSubscriptionLines(subscriptionEntries, isSubscriptionLoading, theme, width),
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

const renderNoUsage = (statusStr: string, theme: ThemeFg, width: number): string => {
  const left = theme.fg('dim', 'Ready');
  if (!statusStr) return truncateToWidth(left, width);

  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(statusStr));
  return truncateToWidth(`${left}${' '.repeat(gap)}${statusStr}`, width);
};

const renderWithUsage = (
  usage: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  },
  statusStr: string,
  theme: ThemeFg,
  width: number
): string => {
  const percent = Math.min(100, Math.round(usage.percent!));
  const bar = renderProgressBar(percent, PROGRESS_WIDTH, theme);
  const label = theme.fg('dim', ` ${percent}%/${formatTokens(usage.contextWindow)}`);
  const left = `${bar}${label}`;

  if (!statusStr) return truncateToWidth(left, width);

  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(statusStr));
  return truncateToWidth(`${left}${' '.repeat(gap)}${statusStr}`, width);
};
