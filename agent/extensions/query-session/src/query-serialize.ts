import {
  truncateTail,
  type SessionEntry,
  type TruncationResult,
} from '@mariozechner/pi-coding-agent';

type TextBlock = {
  type: 'text';
  text: string;
};

type SerializedQueryConversation = {
  conversationText: string;
  serializedBytes: number;
  truncated: boolean;
  notes: string[];
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

const toConversationLine = (entry: SessionEntry): string | undefined => {
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

  const roleLabel = role === 'user' ? 'User' : 'Assistant';
  return `[${entry.id}] ${roleLabel}: ${text}`;
};

const buildConversationText = (entries: SessionEntry[]): string =>
  entries
    .map(toConversationLine)
    .filter((line): line is string => line !== undefined)
    .join('\n\n');

const toSerializedConversation = (
  truncation: TruncationResult,
  maxBytes: number
): SerializedQueryConversation => {
  const notes: string[] = [];

  if (truncation.truncated) {
    notes.push(`Context truncated to the most recent ${maxBytes} bytes.`);
  }

  return {
    conversationText: truncation.content,
    serializedBytes: truncation.outputBytes,
    truncated: truncation.truncated,
    notes,
  };
};

export const serializeConversationForQuery = (
  entries: SessionEntry[],
  maxBytes: number
): SerializedQueryConversation => {
  const fullConversationText = buildConversationText(entries);
  const truncation = truncateTail(fullConversationText, { maxBytes });

  return toSerializedConversation(truncation, maxBytes);
};
