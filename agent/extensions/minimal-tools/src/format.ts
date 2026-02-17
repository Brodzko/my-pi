import { basename as nodeBasename } from 'node:path';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Theme, TruncationResult } from '@mariozechner/pi-coding-agent';
import { formatSize } from '@mariozechner/pi-coding-agent';
import type { Component } from '@mariozechner/pi-tui';
import { truncateToWidth } from '@mariozechner/pi-tui';

// ── Spinner ───────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_INTERVAL_MS = 80;

export const lazyComponent = (buildLine: (spinner: string) => string): Component => ({
  render: (width) => {
    const frame = Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
    const line = buildLine(SPINNER_FRAMES[frame]);
    if (!line) return [];
    return [truncateToWidth(line, width)];
  },
  invalidate: () => {},
});

// ── Colors ────────────────────────────────────────────────────────────────

export const pathColor = (theme: Theme, text: string | undefined) =>
  text ? theme.fg('syntaxVariable', text) : '';

export const valueColor = (theme: Theme, text: string | undefined) =>
  text ? theme.fg('syntaxFunction', text) : '';

// ── Text helpers ──────────────────────────────────────────────────────────

export const basename = (path: string | undefined) =>
  path ? nodeBasename(path) : '';

export const textContent = (result: AgentToolResult<unknown>): string =>
  result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

export const truncationMeta = (
  truncation?: TruncationResult
): string | undefined => {
  if (!truncation) return undefined;
  const lines = `${truncation.totalLines} lines`;
  const size = formatSize(truncation.totalBytes);
  const parts = [lines, size];
  if (truncation.truncated) parts.push('truncated');
  return `(${parts.join(', ')})`;
};

export const previewLines = (
  text: string,
  max: number
): { preview: string; full: string; truncated: boolean } => {
  const lines = text.split('\n');
  const truncated = lines.length > max;
  return {
    preview: lines.slice(0, max).join('\n'),
    full: text,
    truncated,
  };
};

export const colorizeDiff = (diff: string, theme: Theme): string =>
  diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+')) return theme.fg('toolDiffAdded', line);
      if (line.startsWith('-')) return theme.fg('toolDiffRemoved', line);
      if (line.startsWith('@')) return theme.fg('muted', line);
      return theme.fg('toolDiffContext', line);
    })
    .join('\n');

export const expandOnlyBody = (
  result: AgentToolResult<unknown>,
  theme: Theme
): { preview: string; full: string } | undefined => {
  const output = textContent(result).trim();
  if (!output) return undefined;
  const full = output
    .split('\n')
    .map((line) => theme.fg('toolOutput', line))
    .join('\n');
  return { preview: '', full };
};
