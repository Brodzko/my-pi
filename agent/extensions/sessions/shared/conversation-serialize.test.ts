import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { serializeConversation } from './conversation-serialize';

const createMessageEntry = (
  id: string,
  role: 'user' | 'assistant' | 'toolResult',
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
      timestamp: 0,
    },
  }) as unknown as SessionEntry;

describe('serializeConversation', () => {
  it('keeps only user and assistant text blocks', () => {
    const entries: SessionEntry[] = [
      createMessageEntry('1', 'user', '  hello  '),
      createMessageEntry('2', 'assistant', [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: '  done  ' },
      ]),
      createMessageEntry('3', 'toolResult', [
        { type: 'text', text: 'tool output should not be included' },
      ]),
      {
        type: 'model_change',
        id: '4',
        parentId: null,
        timestamp: new Date(0).toISOString(),
        provider: 'x',
        modelId: 'y',
      } as SessionEntry,
    ];

    const result = serializeConversation(entries, { maxBytes: 20_000 });

    expect(result.conversationText).toBe('User: hello\n\nAssistant: done');
    expect(result.truncated).toBe(false);
  });

  it('can include entry ids', () => {
    const entries: SessionEntry[] = [
      createMessageEntry('1', 'user', 'hello'),
      createMessageEntry('2', 'assistant', [{ type: 'text', text: 'done' }]),
    ];

    const result = serializeConversation(entries, {
      maxBytes: 20_000,
      includeEntryId: true,
    });

    expect(result.conversationText).toBe(
      '[1] User: hello\n\n[2] Assistant: done'
    );
  });

  it('truncates from tail and keeps recent content', () => {
    const oldChunk = 'A'.repeat(1_000);
    const recentChunk = 'B'.repeat(1_000);

    const entries: SessionEntry[] = [
      createMessageEntry('1', 'user', oldChunk),
      createMessageEntry('2', 'assistant', [
        { type: 'text', text: recentChunk },
      ]),
    ];

    const result = serializeConversation(entries, { maxBytes: 600 });

    expect(result.truncated).toBe(true);
    expect(result.conversationText).toContain('BBBB');
    expect(result.conversationText).not.toContain('AAAA');
  });
});
