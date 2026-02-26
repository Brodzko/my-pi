import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Theme } from '@mariozechner/pi-coding-agent';
import type { Component } from '@mariozechner/pi-tui';
import { Text } from '@mariozechner/pi-tui';
import type { MinimalToolConfig } from './types';
import { lazyComponent, textContent } from './format';

const EMPTY: Component = { render: () => [], invalidate: () => {} };

export const createMinimalRenderers = <TArgs, TDetails>(
  config: MinimalToolConfig<TArgs, TDetails>
) => {
  // Captured per-call in renderCall, read in renderResult within the same
  // synchronous updateDisplay cycle. Safe because ToolExecutionComponent
  // always calls renderCall before renderResult in a single updateDisplay().
  let lastArgs: TArgs | undefined;

  return {
    renderCall(args: TArgs, theme: Theme): Component {
      lastArgs = args;
      return lazyComponent(indicator => {
        return `${theme.fg('warning', indicator)} ${config.icon} ${config.target(args, theme)}`;
      });
    },

    renderResult(
      result: AgentToolResult<TDetails>,
      options: { expanded: boolean; isPartial: boolean },
      theme: Theme
    ): Component {
      if (options.isPartial) {
        return EMPTY;
      }

      const capturedArgs = lastArgs;

      const metaText = config.meta?.(result);
      const statusLine = metaText ? theme.fg('muted', metaText) : undefined;

      // Custom result component (e.g., ls grid)
      if (config.renderResultComponent) {
        const custom = config.renderResultComponent(
          statusLine ?? '',
          result,
          options,
          theme
        );
        if (custom) return custom;
      }

      // Body content from config
      const bodyContent =
        config.body && capturedArgs
          ? config.body(capturedArgs, result, theme)
          : undefined;

      if (bodyContent) {
        const body = options.expanded ? bodyContent.full : bodyContent.preview;
        if (body && statusLine) return new Text(`${statusLine}\n${body}`, 0, 0);
        if (body) return new Text(body, 0, 0);
        if (statusLine) return new Text(statusLine, 0, 0);
        return EMPTY;
      }

      // Fallback: show raw output when expanded (tools without body config)
      if (options.expanded) {
        const raw = textContent(result).trim();
        if (raw) {
          const styled = raw
            .split('\n')
            .map(line => theme.fg('toolOutput', line))
            .join('\n');
          if (statusLine) return new Text(`${statusLine}\n${styled}`, 0, 0);
          return new Text(styled, 0, 0);
        }
      }

      if (statusLine) return new Text(statusLine, 0, 0);
      return EMPTY;
    },
  };
};
