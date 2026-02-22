import { truncateTail, type SessionEntry } from '@mariozechner/pi-coding-agent';
import { buildConversationText } from './conversation-text';

export type SerializedConversation = {
  conversationText: string;
  serializedBytes: number;
  truncated: boolean;
};

export const serializeConversation = (
  entries: SessionEntry[],
  options: {
    maxBytes: number;
    includeEntryId?: boolean;
  }
): SerializedConversation => {
  const fullConversationText = buildConversationText(entries, {
    includeEntryId: options.includeEntryId ?? false,
  });
  const truncation = truncateTail(fullConversationText, {
    maxBytes: options.maxBytes,
  });

  return {
    conversationText: truncation.content,
    serializedBytes: truncation.outputBytes,
    truncated: truncation.truncated,
  };
};
