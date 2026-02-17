import type {
  ExtensionContext,
  ThemeColor,
} from '@mariozechner/pi-coding-agent';
import type { ReadonlyFooterDataProvider } from '@mariozechner/pi-coding-agent';
import type { TUI } from '@mariozechner/pi-tui';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import { formatTokens } from './format';
import { PROGRESS_WIDTH, renderProgressBar } from './progress-bar';
import type { StatuslineEditor, EditorInfo } from './editor';

type ThemeFg = { fg: (color: ThemeColor, text: string) => string };

type FooterDeps = {
  getEditor: () => StatuslineEditor | null;
  ctx: ExtensionContext;
  buildEditorInfo: (ctx: ExtensionContext) => EditorInfo;
};

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

  return {
    dispose: unsub,
    invalidate() {},
    render(width: number): string[] {
      // Keep editor in sync on each footer render.
      // The editor renders before the footer in the same TUI frame, so any
      // state we set here only takes effect on the *next* frame. When thinking
      // changes we therefore request an extra render so the editor catches up
      // on the very next frame rather than waiting for the next keystroke.
      const info = deps.buildEditorInfo(deps.ctx);
      const ed = deps.getEditor();
      if (ed) {
        ed.setBorderTheme(theme);
        ed.updateInfo(info);
      }
      if (info.thinking !== lastThinking) {
        lastThinking = info.thinking;
        tui.requestRender();
      }

      const usage = deps.ctx.getContextUsage();
      const statuses = footerData.getExtensionStatuses();

      const statusStr = renderStatuses(statuses, theme);

      if (!usage || usage.percent === null) {
        return renderNoUsage(statusStr, theme, width);
      }

      return renderWithUsage(usage, statusStr, theme, width);
    },
  };
};

// ── Private helpers ─────────────────────────────────────────────────

const renderStatuses = (
  statuses: ReadonlyMap<string, string>,
  theme: ThemeFg
): string => {
  const parts: string[] = [];
  for (const [, text] of statuses) {
    parts.push(theme.fg('dim', text));
  }
  return parts.length > 0 ? parts.join(theme.fg('dim', ' │ ')) : '';
};

const renderNoUsage = (
  statusStr: string,
  theme: ThemeFg,
  width: number
): string[] => {
  const left = theme.fg('dim', 'Ready');
  if (!statusStr) return [truncateToWidth(left, width)];
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(statusStr));
  return [truncateToWidth(left + ' '.repeat(gap) + statusStr, width)];
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
): string[] => {
  const percent = Math.min(100, Math.round(usage.percent!));
  const capacity = formatTokens(usage.contextWindow);
  const bar = renderProgressBar(percent, PROGRESS_WIDTH, theme);
  const label = theme.fg('dim', ` ${percent}%/${capacity}`);
  const leftPart = bar + label;

  if (!statusStr) {
    return [truncateToWidth(leftPart, width)];
  }

  const gap = Math.max(
    1,
    width - visibleWidth(leftPart) - visibleWidth(statusStr)
  );
  return [truncateToWidth(leftPart + ' '.repeat(gap) + statusStr, width)];
};
