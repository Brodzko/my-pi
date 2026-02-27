import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  openOptionSelector,
  type ChooseOption,
  type OptionSelectorRequest,
} from './option-selector';

const demoOptions: ChooseOption[] = [
  {
    id: 'mr-1234',
    label: '[!1234] Refactor auth flow',
    hint: '2026-02-27 • draft • martin',
  },
  {
    id: 'mr-1241',
    label: '[!1241] Improve OCR parser fallback',
    hint: '2026-02-27 • ready • adela',
  },
  {
    id: 'mr-1258',
    label: '[!1258] Add retry telemetry',
    hint: '2026-02-26 • ready • pavel',
  },
];

const parseMultiFlag = (args: string): boolean => {
  return args.includes('--multi') || args.includes('-m');
};

export const registerChooseDemoCommand = (pi: ExtensionAPI): void => {
  pi.registerCommand('choose-demo', {
    description:
      'Open a demo finite-choice picker. Pass --multi or -m for multi-select.',
    handler: async (args, ctx) => {
      const multi = parseMultiFlag(args);

      const request: OptionSelectorRequest = {
        prompt: multi
          ? 'Pick merge requests to review'
          : 'Pick one merge request to review',
        options: demoOptions,
        multi,
      };

      const result = await openOptionSelector(ctx, request);

      if (result.cancelled) {
        ctx.ui.notify('choose-demo cancelled', 'warning');
        return;
      }

      const selected = demoOptions.filter(option =>
        result.selectedIds.includes(option.id)
      );

      if (selected.length === 0) {
        ctx.ui.notify('No options selected', 'warning');
        return;
      }

      const summary = selected
        .map(option => `${option.id}: ${option.label}`)
        .join(' | ');

      ctx.ui.notify(`Selected ${selected.length}: ${summary}`, 'info');
    },
  });
};
