import type { ThemeColor } from '@mariozechner/pi-coding-agent';

export const PROGRESS_WIDTH = 15;

export const renderProgressBar = (
  percent: number,
  width: number,
  theme: { fg: (color: ThemeColor, text: string) => string }
): string => {
  const barWidth = Math.max(1, width);
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;

  const color: ThemeColor =
    percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success';

  return (
    theme.fg(color, '▰'.repeat(filled)) + theme.fg('dim', '▱'.repeat(empty))
  );
};
