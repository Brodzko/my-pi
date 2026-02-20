import {
  DEFAULT_MAX_BYTES,
  type SessionEntry,
  truncateTail,
} from '@mariozechner/pi-coding-agent';

type TextBlock = {
  type: 'text';
  text: string;
};

const isTextBlock = (value: unknown): value is TextBlock => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.type === 'text' && typeof candidate.text === 'string';
};

const getTextFromMessageContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter(isTextBlock)
    .map(block => block.text.trim())
    .filter(text => text.length > 0)
    .join('\n')
    .trim();
};

const toConversationSection = (entry: SessionEntry): string | undefined => {
  if (entry.type !== 'message') {
    return undefined;
  }

  const role = entry.message.role;
  if (role !== 'user' && role !== 'assistant') {
    return undefined;
  }

  const text = getTextFromMessageContent(entry.message.content);
  if (!text) {
    return undefined;
  }

  const prefix = role === 'user' ? 'User' : 'Assistant';
  return `${prefix}: ${text}`;
};

export const buildConversationText = (entries: SessionEntry[]): string =>
  entries
    .map(toConversationSection)
    .filter((section): section is string => section !== undefined)
    .join('\n\n');

export const serializeConversationForIndexing = (
  entries: SessionEntry[]
): string => {
  const conversationText = buildConversationText(entries);
  const { content, truncated } = truncateTail(conversationText, {
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncated) {
    return content;
  }

  return `${content}\n\n[Conversation truncated — only the most recent portion is shown]`;
};
