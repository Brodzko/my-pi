import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import type { AssistantMessage } from '@mariozechner/pi-ai';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

export const tildeify = (path: string): string => {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? '~' + path.slice(home.length) : path;
};

export const shortenPath = (path: string, maxLen: number): string => {
  const tildePath = tildeify(path);
  if (visibleWidth(tildePath) <= maxLen) return tildePath;

  const parts = tildePath.split('/');
  if (parts.length <= 2) return truncateToWidth(tildePath, maxLen);

  // Progressively shorten from the leftmost non-root segment,
  // keeping the last 2 segments intact for recognizability.
  const shortened = [...parts];
  for (let i = 1; i < shortened.length - 2; i++) {
    shortened[i] = shortened[i]![0] ?? '';
    const candidate = shortened.join('/');
    if (visibleWidth(candidate) <= maxLen) return candidate;
  }

  return truncateToWidth(shortened.join('/'), maxLen);
};

export const formatCost = (cost: number): string => {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
};

export const formatTokens = (n: number): string => {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(0)}k`;
};

export const getSessionCost = (ctx: ExtensionContext): number => {
  let total = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      total += (entry.message as AssistantMessage).usage.cost.total;
    }
  }
  return total;
};
