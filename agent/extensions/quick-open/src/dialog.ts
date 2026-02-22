import type { ExtensionContext, Theme } from '@mariozechner/pi-coding-agent';
import {
  CURSOR_MARKER,
  type Focusable,
  matchesKey,
  visibleWidth,
} from '@mariozechner/pi-tui';
import * as R from 'remeda';
import { fuzzySearch, type FuzzyResult, type HighlightRange } from './fuzzy';
import type { SessionEntry } from './sessions';

export type QuickOpenMode = 'files' | 'sessions';

export type QuickOpenResult =
  | { type: 'file'; path: string }
  | { type: 'session'; id: string; label: string; file: string }
  | null;

const MAX_VISIBLE = 8;
const DIALOG_WIDTH = 96;

// ─── module-level pure helpers ────────────────────────────────────────────────

/** Pad or left-truncate `s` to exactly `len` visible characters. */
const fit = (s: string, len: number): string => {
  const vis = visibleWidth(s);
  if (vis <= len) return s + ' '.repeat(len - vis);
  let t = s;
  while (visibleWidth('…' + t) > len) t = t.slice(1);
  return '…' + t;
};

/** Wrap content in border characters, padding to `innerW` visible chars. */
const makeRow =
  (theme: Theme, innerW: number) =>
  (content: string): string =>
    theme.fg('border', '│') + fit(content, innerW) + theme.fg('border', '│');

/**
 * Left-truncate a result's item and shift its highlight ranges to match,
 * so that colorizing never needs to slice through ANSI escape sequences.
 * For file paths, string length equals visible width, so the slice is safe.
 */
const truncateResult = (
  result: FuzzyResult,
  maxItemVis: number
): FuzzyResult => {
  if (result.item.length <= maxItemVis) return result;
  const keep = maxItemVis - 1; // 1 char reserved for "…"
  const cutAt = result.item.length - keep;
  return {
    item: '…' + result.item.slice(cutAt),
    refIndex: result.refIndex,
    highlights: result.highlights
      .filter(([, e]) => e >= cutAt)
      .map(
        ([s, e]): HighlightRange => [Math.max(1, s - cutAt + 1), e - cutAt + 1]
      ),
  };
};

/** Colorize a result string, marking matched ranges with a different color. */
const buildHighlighted = (
  result: FuzzyResult,
  isSelected: boolean,
  theme: Theme,
  useAccentText = false
): string => {
  const { item, highlights } = result;
  const plain = (s: string) =>
    isSelected || useAccentText ? theme.fg('accent', s) : theme.fg('text', s);
  const match = (s: string) => theme.fg('accent', s);

  if (highlights.length === 0) return plain(item);

  return R.pipe(
    highlights,
    R.reduce(
      ({ out, pos }, [start, end]) => ({
        out:
          out +
          (pos < start ? plain(item.slice(pos, start)) : '') +
          match(item.slice(start, end + 1)),
        pos: end + 1,
      }),
      { out: '', pos: 0 }
    ),
    ({ out, pos }) => out + plain(item.slice(pos))
  );
};

// ─── component ───────────────────────────────────────────────────────────────

class QuickOpenDialog implements Focusable {
  readonly width = DIALOG_WIDTH;
  focused = false;

  private mode: QuickOpenMode;
  private query = '';
  private cursor = 0;
  private selectedIdx = 0;
  private scrollOffset = 0;
  private results: FuzzyResult[] = [];

  constructor(
    private readonly theme: Theme,
    private readonly files: string[],
    private readonly sessions: SessionEntry[],
    initialMode: QuickOpenMode,
    private readonly done: (result: QuickOpenResult) => void
  ) {
    this.mode = initialMode;
    this.results = fuzzySearch('', this.currentItems());
  }

  // ── state helpers ──────────────────────────────────────────────────────

  private currentItems(): string[] {
    return this.mode === 'files' ? this.files : this.sessions.map(s => s.label);
  }

  private switchMode(newMode: QuickOpenMode): void {
    this.mode = newMode;
    this.query = '';
    this.cursor = 0;
    this.selectedIdx = 0;
    this.scrollOffset = 0;
    this.results = fuzzySearch('', this.currentItems());
  }

  private requery(): void {
    this.results = fuzzySearch(this.query, this.currentItems());
    this.selectedIdx = 0;
    this.scrollOffset = 0;
  }

  private getVisibleItemSlots(scrollOffset: number): number {
    const hasMore = this.results.length > scrollOffset + MAX_VISIBLE;
    return hasMore ? MAX_VISIBLE - 1 : MAX_VISIBLE;
  }

  private clampScroll(): void {
    while (this.selectedIdx < this.scrollOffset) {
      this.scrollOffset--;
    }

    while (
      this.selectedIdx >=
      this.scrollOffset + this.getVisibleItemSlots(this.scrollOffset)
    ) {
      this.scrollOffset++;
    }
  }

  // ── query editing helpers ───────────────────────────────────────────

  private spliceQuery(from: number, to: number, insert = ''): void {
    this.query = this.query.slice(0, from) + insert + this.query.slice(to);
    this.cursor = from + insert.length;
    this.requery();
  }

  /** Find the position option+backspace should delete to. */
  private wordBoundaryLeft(): number {
    let pos = this.cursor;
    while (pos > 0 && this.query[pos - 1] === ' ') pos--;
    if (pos > 0 && this.query[pos - 1] === '/') pos--;
    while (
      pos > 0 &&
      this.query[pos - 1] !== ' ' &&
      this.query[pos - 1] !== '/'
    )
      pos--;
    return pos;
  }

  private resolveSelection(): void {
    const result = this.results[this.selectedIdx];
    if (!result) {
      this.done(null);
      return;
    }
    if (this.mode === 'files') {
      this.done({ type: 'file', path: result.item });
      return;
    }
    const session = this.sessions[result.refIndex];
    this.done(
      session
        ? {
            type: 'session',
            id: session.id,
            label: session.label,
            file: session.file,
          }
        : null
    );
  }

  private moveSelection(delta: number): void {
    const len = this.results.length;
    if (len === 0) return;
    this.selectedIdx = (this.selectedIdx + delta + len) % len;
    this.clampScroll();
  }

  // ── input ──────────────────────────────────────────────────────────────

  private readonly keyHandlers: ReadonlyArray<
    readonly [check: (data: string) => boolean, action: () => void]
  > = [
    [data => matchesKey(data, 'escape'), () => this.done(null)],
    [
      data => matchesKey(data, 'return') || matchesKey(data, 'tab'),
      () => this.resolveSelection(),
    ],
    [data => matchesKey(data, 'up'), () => this.moveSelection(-1)],
    [data => matchesKey(data, 'down'), () => this.moveSelection(1)],
    [
      data => matchesKey(data, 'left'),
      () => {
        this.cursor = Math.max(0, this.cursor - 1);
      },
    ],
    [
      data => matchesKey(data, 'right'),
      () => {
        this.cursor = Math.min(this.query.length, this.cursor + 1);
      },
    ],
    [
      data => matchesKey(data, 'backspace'),
      () => {
        if (this.cursor > 0) {
          this.spliceQuery(this.cursor - 1, this.cursor);
        } else if (this.mode === 'sessions') {
          this.switchMode('files');
        }
      },
    ],
    [
      // option+backspace → delete word
      data => data === '\x1b\x7f',
      () => {
        if (this.cursor > 0)
          this.spliceQuery(this.wordBoundaryLeft(), this.cursor);
      },
    ],
    [
      // cmd+backspace / ctrl+u → delete to start
      data => data === '\x15',
      () => {
        if (this.cursor > 0) this.spliceQuery(0, this.cursor);
      },
    ],
  ];

  handleInput(data: string): void {
    const matched = this.keyHandlers.find(([check]) => check(data));
    if (matched) {
      matched[1]();
      return;
    }

    // Printable character
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      if (data === '@' && this.query === '' && this.mode === 'files') {
        this.switchMode('sessions');
        return;
      }
      this.spliceQuery(this.cursor, this.cursor, data);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────

  private renderTitle(innerW: number): string {
    const titleText = this.mode === 'files' ? 'Quick Open' : 'Sessions';
    const trailingDashes = '─'.repeat(
      Math.max(0, innerW - visibleWidth(titleText) - 3)
    );
    return (
      this.theme.fg('border', '╭─ ') +
      this.theme.fg('accent', titleText) +
      this.theme.fg('border', ' ' + trailingDashes + '╮')
    );
  }

  private renderQuery(): string {
    // In sessions mode, show "@" as a static mode indicator — it's not part
    // of the search query itself, just a visual anchor matching the "@@" tag.
    const prefix = this.mode === 'sessions' ? this.theme.fg('dim', '@') : '';
    const before = this.query.slice(0, this.cursor);
    const atCursor =
      this.cursor < this.query.length ? this.query[this.cursor]! : ' ';
    const after = this.query.slice(this.cursor + 1);
    const imeMarker = this.focused ? CURSOR_MARKER : '';
    return (
      prefix + before + imeMarker + '\x1b[7m' + atCursor + '\x1b[27m' + after
    );
  }

  private renderResults(innerW: number): string[] {
    const th = this.theme;
    const row = makeRow(th, innerW);

    if (this.results.length === 0) {
      return [
        row('  ' + th.fg('dim', 'no matches')),
        ...R.times(MAX_VISIBLE - 1, () => row('')),
      ];
    }

    const hasMore = this.results.length > this.scrollOffset + MAX_VISIBLE;
    const itemSlots = hasMore ? MAX_VISIBLE - 1 : MAX_VISIBLE;
    const maxContentVis = innerW - 3; // " ▶ " prefix is 3 visible chars

    const itemRows = this.results
      .slice(this.scrollOffset, this.scrollOffset + itemSlots)
      .map((result, i) => {
        const isSelected = this.scrollOffset + i === this.selectedIdx;
        const prefix = isSelected ? th.fg('accent', ' ▶ ') : '   ';

        if (this.mode === 'sessions') {
          const session = this.sessions[result.refIndex];
          const ageTag = `[${session?.ago ?? '?'}] `;
          const agePart = th.fg('dim', ageTag);
          const maxLabelVis = Math.max(1, maxContentVis - visibleWidth(ageTag));
          const labelResult = truncateResult(result, maxLabelVis);
          const labelPart = buildHighlighted(
            labelResult,
            isSelected,
            th,
            Boolean(session?.hasName)
          );
          return row(prefix + agePart + labelPart);
        }

        return row(
          prefix +
            buildHighlighted(
              truncateResult(result, maxContentVis),
              isSelected,
              th
            )
        );
      });

    const moreRow = hasMore
      ? [
          row(
            '   ' +
              th.fg(
                'dim',
                `↓ ${this.results.length - this.scrollOffset - itemSlots} more`
              )
          ),
        ]
      : [];

    return [
      ...itemRows,
      ...moreRow,
      ...R.times(MAX_VISIBLE - itemRows.length - moreRow.length, () => row('')),
    ];
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = width - 2;
    const row = makeRow(th, innerW);
    const hint =
      this.mode === 'files'
        ? th.fg('dim', '  ↑↓ navigate · enter select · esc cancel · @ sessions')
        : th.fg('dim', '  ↑↓ navigate · enter select · esc cancel · ⌫ files');

    return [
      this.renderTitle(innerW),
      row(th.fg('dim', '  > ') + this.renderQuery()),
      th.fg('border', '├' + '─'.repeat(innerW) + '┤'),
      ...this.renderResults(innerW),
      row(hint),
      th.fg('border', '╰' + '─'.repeat(innerW) + '╯'),
    ];
  }

  invalidate(): void {}
  dispose(): void {}
}

// ─── public API ──────────────────────────────────────────────────────────────

export const showQuickOpen = (
  ctx: ExtensionContext,
  files: string[],
  sessions: SessionEntry[],
  initialMode: QuickOpenMode
): Promise<QuickOpenResult> =>
  ctx.ui.custom<QuickOpenResult>(
    (_tui, theme, _keybindings, done) =>
      new QuickOpenDialog(theme, files, sessions, initialMode, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: 'top-center',
        width: DIALOG_WIDTH,
        offsetY: 2,
      },
    }
  );
