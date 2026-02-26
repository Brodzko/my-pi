import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import { serializeConversation } from '../../shared/conversation-serialize';

type HandoffStats = {
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
};

export type HandoffContextPayload = {
  conversationText: string;
  serializedBytes: number;
  truncated: boolean;
  stats: HandoffStats;
  touchedFiles: string[];
};

const PATH_ARGUMENT_KEYS = ['path', 'file'] as const;
const PATH_ARRAY_ARGUMENT_KEYS = ['paths', 'files'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
};

const normalizePath = (value: string): string =>
  value.replace(/^['"]+|['"]+$/g, '');

const extractPathCandidatesFromArgs = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }

  const scalarPaths = PATH_ARGUMENT_KEYS.map(key => value[key])
    .map(toNonEmptyString)
    .filter((path): path is string => Boolean(path));

  const arrayPaths = PATH_ARRAY_ARGUMENT_KEYS.flatMap(key => {
    const candidate = value[key];
    if (!Array.isArray(candidate)) {
      return [];
    }

    return candidate
      .map(toNonEmptyString)
      .filter((path): path is string => Boolean(path));
  });

  return [...scalarPaths, ...arrayPaths].map(normalizePath);
};

const isToolCallContentBlock = (
  value: unknown
): value is { type: 'toolCall'; arguments: unknown } => {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === 'toolCall' && 'arguments' in value;
};

export const extractTouchedFiles = (entries: SessionEntry[]): string[] => {
  const touchedFiles = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant') {
      continue;
    }

    const content = entry.message.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const block of content) {
      if (!isToolCallContentBlock(block)) {
        continue;
      }

      for (const path of extractPathCandidatesFromArgs(block.arguments)) {
        touchedFiles.add(path);
      }
    }
  }

  return [...touchedFiles];
};

const countStats = (entries: SessionEntry[]): HandoffStats =>
  entries.reduce<HandoffStats>(
    (stats, entry) => {
      if (entry.type !== 'message') {
        return stats;
      }

      if (entry.message.role === 'user') {
        return {
          ...stats,
          userMessageCount: stats.userMessageCount + 1,
        };
      }

      if (entry.message.role !== 'assistant') {
        return stats;
      }

      const content = Array.isArray(entry.message.content)
        ? entry.message.content
        : [];
      const toolCallCount = content.filter(isToolCallContentBlock).length;

      return {
        ...stats,
        assistantMessageCount: stats.assistantMessageCount + 1,
        toolCallCount: stats.toolCallCount + toolCallCount,
      };
    },
    {
      userMessageCount: 0,
      assistantMessageCount: 0,
      toolCallCount: 0,
    }
  );

export const buildHandoffContextPayload = (
  entries: SessionEntry[],
  maxBytes: number
): HandoffContextPayload => {
  const serialized = serializeConversation(entries, { maxBytes });

  return {
    conversationText: serialized.truncated
      ? `${serialized.conversationText}\n\n[Conversation truncated — only the most recent portion is shown]`
      : serialized.conversationText,
    serializedBytes: serialized.serializedBytes,
    truncated: serialized.truncated,
    stats: countStats(entries),
    touchedFiles: extractTouchedFiles(entries),
  };
};
