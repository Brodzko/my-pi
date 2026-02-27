import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Text } from '@mariozechner/pi-tui';
import { Type } from '@sinclair/typebox';
import { openOptionSelector, type ChooseOption } from './option-selector';

const chooseOptionsParamsSchema = Type.Object({
  prompt: Type.String({
    description: 'Question or prompt shown above the options.',
  }),
  options: Type.Array(
    Type.Object({
      id: Type.String({
        description: 'Stable option id returned in selections.',
      }),
      label: Type.String({ description: 'Primary display label.' }),
      hint: Type.Optional(
        Type.String({
          description: 'Secondary muted text for structured context.',
        })
      ),
    }),
    { description: 'Finite list of options to choose from.' }
  ),
  multi: Type.Optional(
    Type.Boolean({
      description: 'Allow selecting multiple options with space.',
    })
  ),
});

type ChooseOptionsParams = {
  prompt: string;
  options: ChooseOption[];
  multi?: boolean;
};

type ChooseOptionsDetails = {
  selected: ChooseOption[];
  cancelled: boolean;
};

const getUniqueOptions = (
  options: ChooseOption[]
): { unique: ChooseOption[]; duplicates: string[] } => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unique = options.filter(option => {
    if (seen.has(option.id)) {
      duplicates.push(option.id);
      return false;
    }

    seen.add(option.id);
    return true;
  });

  return { unique, duplicates };
};

const formatSelection = (selected: ChooseOption[]): string => {
  if (selected.length === 0) {
    return 'No options selected.';
  }

  return selected.map(option => `- ${option.id}: ${option.label}`).join('\n');
};

export const registerChooseOptionsTool = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: 'choose_options',
    label: 'Choose options',
    description:
      'Ask the user to choose from a finite list of options. Supports single or multi-select and pauses until the user submits.',
    parameters: chooseOptionsParamsSchema,

    async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
      const params = input as ChooseOptionsParams;
      const { unique: options, duplicates } = getUniqueOptions(params.options);

      if (duplicates.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Duplicate option ids are not allowed: ${duplicates.join(', ')}`,
            },
          ],
          details: {
            selected: [],
            cancelled: true,
          } satisfies ChooseOptionsDetails,
        };
      }

      if (options.length === 0) {
        return {
          content: [{ type: 'text', text: 'No options provided.' }],
          details: {
            selected: [],
            cancelled: false,
          } satisfies ChooseOptionsDetails,
        };
      }

      const selection = await openOptionSelector(ctx, {
        prompt: params.prompt,
        options,
        multi: params.multi ?? false,
      });

      const selected = options.filter(option =>
        selection.selectedIds.includes(option.id)
      );

      if (selection.cancelled) {
        return {
          content: [{ type: 'text', text: 'User cancelled option selection.' }],
          details: {
            selected: [],
            cancelled: true,
          } satisfies ChooseOptionsDetails,
        };
      }

      return {
        content: [{ type: 'text', text: formatSelection(selected) }],
        details: {
          selected,
          cancelled: false,
        } satisfies ChooseOptionsDetails,
      };
    },

    renderCall(args, theme) {
      const typedArgs = args as ChooseOptionsParams;
      const count = typedArgs.options.length;
      const mode = typedArgs.multi ? 'multi' : 'single';

      return new Text(
        `${theme.fg('toolTitle', theme.bold('choose_options '))}${theme.fg(
          'muted',
          typedArgs.prompt
        )}\n${theme.fg('dim', `  mode: ${mode} • options: ${count}`)}`,
        0,
        0
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as ChooseOptionsDetails | undefined;
      if (!details) {
        return new Text('', 0, 0);
      }

      if (details.cancelled) {
        return new Text(theme.fg('warning', 'Cancelled'), 0, 0);
      }

      if (details.selected.length === 0) {
        return new Text(theme.fg('warning', 'No options selected'), 0, 0);
      }

      const lines = details.selected.map(
        option => `${theme.fg('success', '✓ ')}${option.id}: ${option.label}`
      );
      return new Text(lines.join('\n'), 0, 0);
    },
  });
};
