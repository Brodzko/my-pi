import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Theme } from '@mariozechner/pi-coding-agent';
import type { Component } from '@mariozechner/pi-tui';

export const PREVIEW_LINES = 5;

export type MinimalToolConfig<TArgs, TDetails> = {
  icon: string;
  target: (args: TArgs, theme: Theme) => string;
  meta?: (result: AgentToolResult<TDetails>) => string | undefined;
  body?: (
    args: TArgs,
    result: AgentToolResult<TDetails>,
    theme: Theme
  ) => { preview: string; full: string } | undefined;
  renderResultComponent?: (
    statusLine: string,
    args: TArgs,
    result: AgentToolResult<TDetails>,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme
  ) => Component | undefined;
};
