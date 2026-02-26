import type { ExtensionContext, Theme } from '@mariozechner/pi-coding-agent';
import {
  CURSOR_MARKER,
  type Focusable,
  matchesKey,
  type TUI,
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

export type QuickOpenInitialData = {
  files: string[];
  sessions: SessionEntry[];
};

export type QuickOpenDataLoaders = {
  files: () => Promise<string[]>;
  sessions: () => Promise<SessionEntry[]>;
};

export type QuickOpenLoadingState = {
  files: boolean;
  sessions: boolean;
};

const MAX_VISIBLE = 8;
const DIALOG_WIDTH = 96;

const fit = (s: string, len: number): string => {
  const vis = visibleWidth(s);
  if (vis <= len) return s + ' '.repeat(len - vis);
  let t = s;
  while (visibleWidth('…' + t) > len) t = t.slice(1);
  return '…' + t;
};

const makeRow =
  (theme: Theme, innerW: number) =>
  (content: string): string =>
    theme.fg('border', '│') + fit(content, innerW) + theme.fg('border', '│');

const truncateResult = (
  result: FuzzyResult,
  maxItemVis: number
): FuzzyResult => {
  if (result.item.length <= maxItemVis) return result;
  const keep = maxItemVis - 1;
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

class QuickOpenDialog implements Focusable {
  readonly width = DIALOG_WIDTH;
  focused = false;

  private mode: QuickOpenMode;
  private query = '';
  private cursor = 0;
  private selectedIdx = 0;
  private scrollOffset = 0;
  private results: FuzzyResult[] = [];

  private files: string[];
  private sessions: SessionEntry[];
  private filesLoading: boolean;
  private sessionsLoading: boolean;
  private sessionsLoaded = false;
  private filesLoadPromise: Promise<void> | null = null;
  private sessionsLoadPromise: Promise<void> | null = null;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    initialData: QuickOpenInitialData,
    private readonly loaders: QuickOpenDataLoaders,
    loadingState: QuickOpenLoadingState,
    initialMode: QuickOpenMode,
    private readonly done: (result: QuickOpenResult) => void
  ) {
    this.mode = initialMode;
    this.files = initialData.files;
    this.sessions = initialData.sessions;
    this.filesLoading = loadingState.files;
    this.sessionsLoading = loadingState.sessions;
    this.sessionsLoaded =
      initialData.sessions.length > 0 || loadingState.sessions === true;

    this.results = fuzzySearch('', this.currentItems());

    if (this.filesLoading) {
      void this.loadFiles();
    }

    if (this.mode === 'sessions') {
      this.ensureSessionsLoaded();
    }
  }

  private currentItems(): string[] {
    return this.mode === 'files' ? this.files : this.sessions.map(s => s.label);
  }

  private isCurrentModeLoading(): boolean {
    return this.mode === 'files' ? this.filesLoading : this.sessionsLoading;
  }

  private switchMode(newMode: QuickOpenMode): void {
    this.mode = newMode;
    this.query = '';
    this.cursor = 0;
    this.selectedIdx = 0;
    this.scrollOffset = 0;
    this.results = fuzzySearch('', this.currentItems());

    if (newMode === 'sessions') {
      this.ensureSessionsLoaded();
    }
  }

  private requery(): void {
    this.results = fuzzySearch(this.query, this.currentItems());
    this.selectedIdx = 0;
    this.scrollOffset = 0;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private async loadFiles(): Promise<void> {
    if (this.filesLoadPromise) {
      await this.filesLoadPromise;
      return;
    }

    this.filesLoadPromise = this.loaders
      .files()
      .then(files => {
        this.files = files;
      })
      .finally(() => {
        this.filesLoading = false;
        this.filesLoadPromise = null;
        if (this.mode === 'files') {
          this.requery();
        }
        this.requestRender();
      });

    await this.filesLoadPromise;
  }

  private ensureSessionsLoaded(): void {
    if (
      this.sessionsLoaded ||
      this.sessionsLoading ||
      this.sessionsLoadPromise
    ) {
      return;
    }

    this.sessionsLoading = true;
    this.sessionsLoadPromise = this.loaders
      .sessions()
      .then(sessions => {
        this.sessions = sessions;
        this.sessionsLoaded = true;
      })
      .finally(() => {
        this.sessionsLoading = false;
        this.sessionsLoadPromise = null;
        if (this.mode === 'sessions') {
          this.requery();
        }
        this.requestRender();
      });
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

  private spliceQuery(from: number, to: number, insert = ''): void {
    this.query = this.query.slice(0, from) + insert + this.query.slice(to);
    this.cursor = from + insert.length;
    this.requery();
  }

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
      if (!this.isCurrentModeLoading()) {
        this.done(null);
      }
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
        } else {
          this.done(null);
        }
      },
    ],
    [
      data => data === '\x1b\x7f',
      () => {
        if (this.cursor > 0)
          this.spliceQuery(this.wordBoundaryLeft(), this.cursor);
      },
    ],
    [
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

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      if (data === '@' && this.query === '' && this.mode === 'files') {
        this.switchMode('sessions');
        return;
      }
      this.spliceQuery(this.cursor, this.cursor, data);
    }
  }

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
      const loadingLabel =
        this.mode === 'files' ? 'loading files…' : 'loading sessions…';
      return [
        row(
          '  ' +
            th.fg(
              'dim',
              this.isCurrentModeLoading() ? loadingLabel : 'no matches'
            )
        ),
        ...R.times(MAX_VISIBLE - 1, () => row('')),
      ];
    }

    const hasMore = this.results.length > this.scrollOffset + MAX_VISIBLE;
    const itemSlots = hasMore ? MAX_VISIBLE - 1 : MAX_VISIBLE;
    const maxContentVis = innerW - 3;

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

export const showQuickOpen = (
  ctx: ExtensionContext,
  initialData: QuickOpenInitialData,
  loaders: QuickOpenDataLoaders,
  loadingState: QuickOpenLoadingState,
  initialMode: QuickOpenMode
): Promise<QuickOpenResult> =>
  ctx.ui.custom<QuickOpenResult>(
    (tui, theme, _keybindings, done) =>
      new QuickOpenDialog(
        tui,
        theme,
        initialData,
        loaders,
        loadingState,
        initialMode,
        done
      ),
    {
      overlay: true,
      overlayOptions: {
        anchor: 'top-center',
        width: DIALOG_WIDTH,
        offsetY: 2,
      },
    }
  );
