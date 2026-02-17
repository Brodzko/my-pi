import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Theme } from '@mariozechner/pi-coding-agent';
import type { Component } from '@mariozechner/pi-tui';
import { Text } from '@mariozechner/pi-tui';
import type { MinimalToolConfig } from './types';
import { lazyComponent } from './format';

export const createMinimalRenderers = <TArgs, TDetails>(
  config: MinimalToolConfig<TArgs, TDetails>
) => {
  let lastArgs: TArgs | undefined;
  let completed = false;

  return {
    renderCall(args: TArgs, theme: Theme): Component {
      lastArgs = args;
      completed = false;

      return lazyComponent((spinner) => {
        if (completed) return '';
        return `${theme.fg('warning', spinner)} ${config.icon} ${config.target(args, theme)}`;
      });
    },

    renderResult(
      result: AgentToolResult<TDetails>,
      options: { expanded: boolean; isPartial: boolean },
      theme: Theme
    ): Component {
      if (options.isPartial) {
        return new Text(theme.fg('muted', '…'), 0, 0);
      }

      completed = true;
      const meta = config.meta?.(result);

      const targetStr = lastArgs ? config.target(lastArgs, theme) : '';
      const metaPart = meta ? ' ' + theme.fg('muted', meta) : '';
      const statusLine = `${theme.fg('success', '✓')} ${config.icon} ${targetStr}${metaPart}`;

      if (config.renderResultComponent && lastArgs) {
        const component = config.renderResultComponent(
          statusLine,
          lastArgs,
          result,
          options,
          theme
        );
        if (component) return component;
      }

      if (config.body && lastArgs) {
        const bodyContent = config.body(lastArgs, result, theme);
        if (bodyContent) {
          const bodyText = options.expanded
            ? bodyContent.full
            : bodyContent.preview;
          if (bodyText) return new Text(statusLine + '\n\n' + bodyText, 0, 0);
        }
      }

      return new Text(statusLine, 0, 0);
    },
  };
};
