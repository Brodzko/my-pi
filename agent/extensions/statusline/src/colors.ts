import chalk from 'chalk';
import type { ThemeColor } from '@mariozechner/pi-coding-agent';

export const thinkingLabelColor = (
  level: string,
  dimFn: (s: string) => string
): ((s: string) => string) => {
  switch (level) {
    case 'medium':
      return (s: string) => chalk.bold.cyan(s);
    case 'high':
    case 'xhigh':
      return (s: string) => chalk.bold.yellowBright(s);
    default:
      return dimFn;
  }
};

/** Map thinking level name to the matching ThemeColor for border tinting. */
export const thinkingBorderColor = (thinking: string): ThemeColor =>
  `thinking${thinking.charAt(0).toUpperCase()}${thinking.slice(1)}` as ThemeColor;
