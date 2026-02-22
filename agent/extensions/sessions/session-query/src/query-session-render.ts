import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  getMarkdownTheme,
  type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
} from '@mariozechner/pi-tui';
import type { QuerySessionResult } from './types';

const MAX_CALL_PREVIEW_CHARS = 72;
const QUERY_SESSION_TOOL_ICON = '🔎';
const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;
const SPINNER_INTERVAL_MS = 80;

type ToolTheme = ExtensionContext['ui']['theme'];

type ThemeTone = Parameters<ToolTheme['fg']>[0];

const applyFg = (theme: ToolTheme, tone: ThemeTone, text: string): string => {
  try {
    return theme.fg(tone, text);
  } catch {
    return text;
  }
};

const applyBold = (theme: ToolTheme, text: string): string => {
  try {
    return theme.bold(text);
  } catch {
    return text;
  }
};

const truncatePreview = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 1)}…`;
};

const toStringOrFallback = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const parseMaybeJsonString = (args: unknown): unknown => {
  if (typeof args !== 'string') {
    return args;
  }

  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
};

const normalizeQuerySessionArgs = (
  args: unknown
): { session: string; question: string } => {
  const parsedArgs = parseMaybeJsonString(args);

  if (typeof parsedArgs !== 'object' || parsedArgs === null) {
    return {
      session: '?',
      question: '(no question)',
    };
  }

  const objectArgs = parsedArgs as {
    session?: unknown;
    question?: unknown;
    questions?: unknown;
  };

  return {
    session: toStringOrFallback(objectArgs.session, '?'),
    question: toStringOrFallback(
      objectArgs.question ?? objectArgs.questions,
      '(no question)'
    ),
  };
};

const formatQuerySessionTarget = (args: unknown, theme: ToolTheme): string => {
  const normalizedArgs = normalizeQuerySessionArgs(args);
  const questionPreview = truncatePreview(
    normalizedArgs.question,
    MAX_CALL_PREVIEW_CHARS
  );

  return [
    applyBold(theme, 'query_session'),
    applyFg(theme, 'syntaxVariable', normalizedArgs.session),
    applyFg(theme, 'muted', `— ${questionPreview}`),
  ].join(' ');
};

const getTextContent = (result: AgentToolResult<unknown>): string =>
  (result.content ?? [])
    .filter(
      (
        content
      ): content is Extract<
        AgentToolResult<unknown>['content'][number],
        { type: 'text' }
      > => content.type === 'text'
    )
    .map(content => content.text)
    .join('\n')
    .trim();

export const createQuerySessionRenderers = () => {
  let lastArgs: unknown;
  let completed = false;

  return {
    renderCall: (args: unknown, theme: ToolTheme) => {
      lastArgs = args;
      completed = false;

      return {
        render: (width: number) => {
          try {
            if (completed) {
              return [];
            }

            const frame =
              Math.floor(Date.now() / SPINNER_INTERVAL_MS) %
              SPINNER_FRAMES.length;
            const line = `${applyFg(theme, 'warning', SPINNER_FRAMES[frame])} ${QUERY_SESSION_TOOL_ICON} ${formatQuerySessionTarget(args, theme)}`;
            return [truncateToWidth(line, width)];
          } catch {
            return [truncateToWidth('🔎 query_session', width)];
          }
        },
        invalidate: () => undefined,
      };
    },
    renderResult: (
      result: AgentToolResult<QuerySessionResult>,
      options: { expanded: boolean; isPartial: boolean },
      theme: ToolTheme
    ) => {
      if (options.isPartial) {
        return {
          render: (width: number) => [
            truncateToWidth(applyFg(theme, 'muted', '…'), width),
          ],
          invalidate: () => undefined,
        };
      }

      completed = true;

      const statusLine = `${applyFg(theme, 'success', '✓')} ${QUERY_SESSION_TOOL_ICON} ${formatQuerySessionTarget(lastArgs, theme)}`;
      const answerMarkdown = getTextContent(result);

      if (!options.expanded || !answerMarkdown) {
        return new Text(statusLine, 0, 0);
      }

      try {
        const container = new Container();

        container.addChild(new Text(statusLine, 0, 0));
        container.addChild(new Spacer(1));
        container.addChild(
          new Markdown(answerMarkdown, 0, 0, getMarkdownTheme(), {
            color: (text: string) => applyFg(theme, 'toolOutput', text),
          })
        );

        return container;
      } catch {
        return new Text('✓ 🔎 query_session', 0, 0);
      }
    },
  };
};
