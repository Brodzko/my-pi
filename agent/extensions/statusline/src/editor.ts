import type {
  KeybindingsManager,
  ThemeColor,
} from '@mariozechner/pi-coding-agent';
import { CustomEditor } from '@mariozechner/pi-coding-agent';
import { visibleWidth, type EditorTheme, type TUI } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { buildBorderLine } from './border';
import { thinkingBorderColor, thinkingLabelColor } from './colors';
import { formatCost, shortenPath } from './format';
import type { GitStatus } from './git';
import { EMPTY_GIT_STATUS, formatGitStatus } from './git';

export type EditorInfo = {
  cwd: string;
  branch: string | null;
  gitStatus: GitStatus;
  cost: number;
  model: string;
  thinking: string;
};

type ThemeFg = { fg: (color: ThemeColor, text: string) => string };

export class StatuslineEditor extends CustomEditor {
  private info: EditorInfo = {
    cwd: '',
    branch: null,
    gitStatus: { ...EMPTY_GIT_STATUS },
    cost: 0,
    model: '',
    thinking: '',
  };
  private borderTheme: ThemeFg | null = null;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
  }

  setBorderTheme(theme: ThemeFg) {
    if (theme === this.borderTheme) return;
    this.borderTheme = theme;
    this.applyBorderColor();
  }

  updateInfo(info: EditorInfo) {
    this.info = info;
    this.applyBorderColor();
  }

  private lastAppliedThinking = '';
  private lastAppliedTheme: ThemeFg | null = null;

  private applyBorderColor() {
    if (!this.borderTheme || !this.info.thinking) return;
    if (
      this.info.thinking === this.lastAppliedThinking &&
      this.borderTheme === this.lastAppliedTheme
    )
      return;
    this.lastAppliedThinking = this.info.thinking;
    this.lastAppliedTheme = this.borderTheme;
    const color = thinkingBorderColor(this.info.thinking);
    const theme = this.borderTheme;
    this.borderColor = (s: string) => theme.fg(color, s);
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 2 || !this.borderTheme) return lines;

    const bc = this.borderColor.bind(this);
    const theme = this.borderTheme;

    lines[0] = this.renderTopBorder(width, bc, theme);

    const bottomIdx = this.findBottomBorderIndex(lines);
    if (bottomIdx >= 0) {
      lines[bottomIdx] = this.renderBottomBorder(width, bc, theme);
    }

    return lines;
  }

  // ── Private ───────────────────────────────────────────────────────

  private renderTopBorder(
    width: number,
    bc: (s: string) => string,
    theme: ThemeFg
  ): string {
    const maxCwdWidth = Math.min(
      Math.floor(width * 0.5),
      Math.max(20, width - 40)
    );
    const cwdStr = shortenPath(this.info.cwd, maxCwdWidth);

    let left = ' ' + theme.fg('accent', chalk.bold('\uf07b ' + cwdStr)) + ' ';

    if (this.info.branch) {
      const statusStr = formatGitStatus(this.info.gitStatus);
      left +=
        theme.fg('dim', 'on') +
        ' ' +
        chalk.bold.magenta('\ue725 ' + this.info.branch) +
        (statusStr ? ' ' + chalk.bold.redBright(statusStr) : '') +
        ' ';
    }

    const right = ' ' + chalk.yellowBright(formatCost(this.info.cost)) + ' ';

    return buildBorderLine(left, right, width, bc);
  }

  private renderBottomBorder(
    width: number,
    bc: (s: string) => string,
    theme: ThemeFg
  ): string {
    const modelLabel = this.info.model
      ? ' ' + theme.fg('dim', this.info.model) + ' '
      : '';

    const colorFn = thinkingLabelColor(this.info.thinking, s =>
      theme.fg('dim', s)
    );
    const thinkingLabel =
      this.info.thinking && this.info.thinking !== 'off'
        ? ' ' + colorFn(this.info.thinking) + ' '
        : '';

    const right =
      modelLabel +
      (modelLabel && thinkingLabel ? bc('───') : '') +
      thinkingLabel;

    return buildBorderLine('', right, width, bc);
  }

  private findBottomBorderIndex(lines: string[]): number {
    for (let i = lines.length - 1; i >= 1; i--) {
      const stripped = lines[i]!.replace(/\x1b\[[^m]*m/g, '');
      const trimmed = stripped.trim();
      if (
        trimmed.length > 0 &&
        (trimmed.startsWith('─') || trimmed.startsWith('↓'))
      ) {
        const borderChars = trimmed.replace(/[^─↓↑\s\dmore]/g, '');
        if (borderChars.length / trimmed.length > 0.5) return i;
      }
    }
    return lines.length >= 2 ? lines.length - 1 : -1;
  }
}
