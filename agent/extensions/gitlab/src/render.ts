import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import { Text, truncateToWidth } from '@mariozechner/pi-tui';
import type { Component } from '@mariozechner/pi-tui';
import type { Theme } from '@mariozechner/pi-coding-agent';

const ICON = '🦊';
const PENDING_INDICATOR = '⋯';

type GlToolParams = { command: string };

type GlToolDetails = {
  exitCode?: number;
  stderr?: string;
};

const EMPTY: Component = { render: () => [], invalidate: () => {} };

const getTextContent = (result: AgentToolResult<GlToolDetails>): string =>
  result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();

const summarizeJson = (text: string): string | null => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed.ok && parsed.error) {
      return `error: ${parsed.error.code ?? parsed.error.message ?? 'unknown'}`;
    }

    if (parsed.ok && parsed.data) {
      if (Array.isArray(parsed.data)) {
        return `OK, ${parsed.data.length} item${parsed.data.length !== 1 ? 's' : ''}`;
      }

      if (parsed.data.iid) {
        return `OK, !${parsed.data.iid}`;
      }

      return 'OK';
    }

    return null;
  } catch {
    return null;
  }
};

const prettifyJson = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

export const renderCall = (args: GlToolParams, theme: Theme): Component => {
  const title = theme.fg('toolTitle', theme.bold('gl '));
  const command = theme.fg('accent', args.command);

  return {
    render: (width: number) => {
      const line = `${theme.fg('warning', PENDING_INDICATOR)} ${ICON} ${title}${command}`;
      return [truncateToWidth(line, width)];
    },
    invalidate: () => {},
  };
};

export const renderResult = (
  result: AgentToolResult<GlToolDetails>,
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme
): Component => {
  if (options.isPartial) {
    return EMPTY;
  }

  const text = getTextContent(result);
  const summary = summarizeJson(text);
  const statusLine = summary ? theme.fg('muted', `(${summary})`) : undefined;

  if (!options.expanded) {
    if (statusLine) return new Text(statusLine, 0, 0);
    return EMPTY;
  }

  // Expanded: summary + prettified JSON
  const pretty = prettifyJson(text);
  const styled = pretty
    .split('\n')
    .map(line => theme.fg('toolOutput', line))
    .join('\n');

  if (statusLine) return new Text(`${statusLine}\n${styled}`, 0, 0);
  return new Text(styled, 0, 0);
};
