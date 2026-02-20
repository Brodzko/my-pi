import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  buildConversationText,
  serializeConversationForIndexing,
} from './serialize';

const createMessageEntry = (
  id: string,
  role: 'user' | 'assistant',
  content: unknown
): SessionEntry =>
  ({
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role,
      content,
      timestamp: Date.now(),
    },
  }) as unknown as SessionEntry;

describe('buildConversationText', () => {
  it('keeps only user/assistant text content', () => {
    const entries: SessionEntry[] = [
      createMessageEntry('1', 'user', '  hello  '),
      createMessageEntry('2', 'assistant', [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: '  done  ' },
        { type: 'toolCall', name: 'read', arguments: {} },
      ]),
      {
        type: 'model_change',
        id: '3',
        parentId: null,
        timestamp: new Date(0).toISOString(),
        provider: 'x',
        modelId: 'y',
      } as SessionEntry,
    ];

    expect(buildConversationText(entries)).toBe(
      'User: hello\n\nAssistant: done'
    );
  });
});

describe('serializeConversationForIndexing', () => {
  it('truncates from the tail and keeps recent content', () => {
    const oldChunk = 'A'.repeat(40_000);
    const recentChunk = 'B'.repeat(40_000);

    const entries: SessionEntry[] = [
      createMessageEntry('1', 'user', oldChunk),
      createMessageEntry('2', 'assistant', [
        { type: 'text', text: recentChunk },
      ]),
    ];

    const result = serializeConversationForIndexing(entries);

    expect(result).toContain(
      '[Conversation truncated — only the most recent portion is shown]'
    );
    expect(result).toContain('BBBB');
    expect(result).not.toContain('AAAA');
  });
});
