import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import { getTextFromMessageContent } from '../../shared/message-content';

const toConversationLine = (
  entry: SessionEntry,
  options: { includeEntryId: boolean }
): string | undefined => {
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
  if (!options.includeEntryId) {
    return `${roleLabel}: ${text}`;
  }

  return `[${entry.id}] ${roleLabel}: ${text}`;
};

export const buildConversationText = (
  entries: SessionEntry[],
  options: { includeEntryId?: boolean } = {}
): string => {
  const includeEntryId = options.includeEntryId ?? false;

  return entries
    .map(entry => toConversationLine(entry, { includeEntryId }))
    .filter((line): line is string => line !== undefined)
    .join('\n\n');
};
