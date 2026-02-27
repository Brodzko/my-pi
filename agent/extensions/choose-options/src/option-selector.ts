import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Key, matchesKey, truncateToWidth } from '@mariozechner/pi-tui';

export type ChooseOption = {
  id: string;
  label: string;
  hint?: string;
};

export type OptionSelectorRequest = {
  prompt: string;
  options: ChooseOption[];
  multi: boolean;
};

export type OptionSelectorResult = {
  selectedIds: string[];
  cancelled: boolean;
};

export const openOptionSelector = async (
  ctx: ExtensionContext,
  request: OptionSelectorRequest
): Promise<OptionSelectorResult> => {
  if (!ctx.hasUI) {
    return { selectedIds: [], cancelled: true };
  }

  if (request.options.length === 0) {
    return { selectedIds: [], cancelled: false };
  }

  return ctx.ui.custom<OptionSelectorResult>((tui, theme, _kb, done) => {
    let cursor = 0;
    let cache: string[] | undefined;
    const selectedIds = new Set<string>();

    const requestRender = (): void => {
      cache = undefined;
      tui.requestRender();
    };

    const submit = (): void => {
      done({
        selectedIds: request.options
          .filter(option => selectedIds.has(option.id))
          .map(option => option.id),
        cancelled: false,
      });
    };

    const toggleCurrent = (): void => {
      const option = request.options[cursor];
      if (!option) {
        return;
      }

      if (selectedIds.has(option.id)) {
        selectedIds.delete(option.id);
      } else {
        selectedIds.add(option.id);
      }
    };

    const selectCurrentSingle = (): void => {
      const option = request.options[cursor];
      if (!option) {
        return;
      }

      done({ selectedIds: [option.id], cancelled: false });
    };

    return {
      handleInput: data => {
        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          requestRender();
          return;
        }

        if (matchesKey(data, Key.down)) {
          cursor = Math.min(request.options.length - 1, cursor + 1);
          requestRender();
          return;
        }

        if (request.multi && matchesKey(data, Key.space)) {
          toggleCurrent();
          requestRender();
          return;
        }

        if (matchesKey(data, Key.enter)) {
          if (request.multi) {
            submit();
          } else {
            selectCurrentSingle();
          }
          return;
        }

        if (matchesKey(data, Key.escape)) {
          done({ selectedIds: [], cancelled: true });
        }
      },
      invalidate: () => {
        cache = undefined;
      },
      render: width => {
        if (cache) {
          return cache;
        }

        const lines: string[] = [];
        const addLine = (value: string): void => {
          lines.push(truncateToWidth(value, width));
        };

        addLine(theme.fg('accent', '─'.repeat(width)));
        addLine(theme.fg('text', ` ${request.prompt}`));
        lines.push('');

        request.options.forEach((option, index) => {
          const focused = index === cursor;
          const cursorPrefix = focused ? theme.fg('accent', '› ') : '  ';
          const active = selectedIds.has(option.id);
          const marker = request.multi
            ? active
              ? theme.fg('success', '[x] ')
              : theme.fg('muted', '[ ] ')
            : focused
              ? theme.fg('accent', '(•) ')
              : theme.fg('muted', '( ) ');

          const label = focused
            ? theme.fg('accent', option.label)
            : theme.fg('text', option.label);

          addLine(`${cursorPrefix}${marker}${label}`);

          if (option.hint) {
            addLine(`    ${theme.fg('muted', option.hint)}`);
          }
        });

        lines.push('');
        const help = request.multi
          ? ' ↑↓ move • space toggle • enter submit • esc cancel'
          : ' ↑↓ move • enter select • esc cancel';
        addLine(theme.fg('dim', help));
        addLine(theme.fg('accent', '─'.repeat(width)));

        cache = lines;
        return lines;
      },
    };
  });
};
