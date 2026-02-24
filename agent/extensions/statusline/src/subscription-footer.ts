import chalk from 'chalk';
import type { ThemeColor } from '@mariozechner/pi-coding-agent';
import { truncateToWidth } from '@mariozechner/pi-tui';
import { PROGRESS_WIDTH } from './progress-bar';
import type {
  ProviderId,
  SubscriptionUsageEntry,
  WindowKey,
  WindowUsage,
} from './subscription-limits';

type ThemeFg = { fg: (color: ThemeColor, text: string) => string };

const windowOrder: WindowKey[] = ['5h', '1w'];

export const modelProviderToUsageProvider = (
  provider: string | undefined
): ProviderId | null => {
  if (provider === 'openai-codex') return 'openai-codex';
  if (provider === 'anthropic') return 'anthropic';
  return null;
};

const providerLabel = (provider: ProviderId): string =>
  provider === 'openai-codex' ? 'OpenAI' : 'Anthropic';

const providerColorize = (provider: ProviderId, text: string): string =>
  provider === 'openai-codex' ? chalk.cyan(text) : chalk.hex('#f59e0b')(text);

const windowUsedPercent = (window: WindowUsage): number | null => {
  if (window.usedPercent !== undefined) {
    return Math.max(0, Math.min(100, window.usedPercent));
  }

  if (window.used !== undefined && window.limit !== undefined && window.limit > 0) {
    return Math.max(0, Math.min(100, (window.used / window.limit) * 100));
  }

  if (window.remaining !== undefined && window.limit !== undefined && window.limit > 0) {
    const usedFromRemaining = window.limit - window.remaining;
    return Math.max(0, Math.min(100, (usedFromRemaining / window.limit) * 100));
  }

  return null;
};

const formatResetIn = (window: WindowUsage): string | null => {
  if (!window.resetAtMs) return null;

  const diffMs = Math.max(0, window.resetAtMs - Date.now());
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);

  if (days > 0) return `${days}d${hours > 0 ? `${hours}h` : ''}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ''}`;
  return `${Math.max(1, minutes)}m`;
};

const renderSemaphoreBar = (remainingPercent: number, theme: ThemeFg): string => {
  const filled = Math.round((remainingPercent / 100) * PROGRESS_WIDTH);
  const empty = PROGRESS_WIDTH - filled;

  const color: ThemeColor =
    remainingPercent >= 75
      ? 'success'
      : remainingPercent >= 25
        ? 'warning'
        : 'error';

  return theme.fg(color, '▰'.repeat(filled)) + theme.fg('dim', '▱'.repeat(empty));
};

const renderWindowSegment = (
  provider: ProviderId,
  windowKey: WindowKey,
  window: WindowUsage | undefined,
  theme: ThemeFg
): string => {
  const label = providerColorize(provider, windowKey);
  if (!window) {
    return `${label} ${theme.fg('dim', 'unknown')}`;
  }

  const usedPercent = windowUsedPercent(window);
  if (usedPercent === null) {
    return `${label} ${theme.fg('dim', 'unknown')}`;
  }

  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  const displayPercent = Math.floor(remainingPercent);
  const bar = renderSemaphoreBar(remainingPercent, theme);
  const resetIn = formatResetIn(window);

  if (!resetIn) {
    return `${label} ${bar} ${displayPercent}%`;
  }

  return `${label} ${bar} ${displayPercent}% ${theme.fg('dim', `resets in ${resetIn}`)}`;
};

const renderEntryLine = (
  entry: SubscriptionUsageEntry,
  theme: ThemeFg,
  width: number
): string => {
  const coloredProvider = providerColorize(entry.provider, providerLabel(entry.provider));

  if (!entry.usage) {
    return truncateToWidth(`${coloredProvider} ${theme.fg('dim', 'unavailable')}`, width);
  }

  const windowsByKey = new Map(entry.usage.windows.map(window => [window.key, window]));
  const segments = windowOrder.map(windowKey =>
    renderWindowSegment(entry.provider, windowKey, windowsByKey.get(windowKey), theme)
  );

  return truncateToWidth(
    `${coloredProvider} ${segments.join(theme.fg('dim', ' • '))}`,
    width
  );
};

export const renderSubscriptionLines = (
  entries: SubscriptionUsageEntry[] | null,
  isLoading: boolean,
  theme: ThemeFg,
  width: number
): string[] => {
  if (!entries && !isLoading) return [];
  if (!entries && isLoading) {
    return [truncateToWidth(theme.fg('dim', 'subscription usage loading…'), width)];
  }

  const resolvedEntries = entries ?? [];
  return resolvedEntries.map(entry => renderEntryLine(entry, theme, width));
};
