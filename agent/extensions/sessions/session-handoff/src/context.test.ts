import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { buildHandoffContextPayload, extractTouchedFiles } from './context';

const createAssistantToolCallEntry = (
  id: string,
  toolName: string,
  argumentsValue: unknown
): SessionEntry =>
  ({
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: `tool-${id}`,
          name: toolName,
          arguments: argumentsValue,
        },
      ],
      timestamp: 0,
      api: 'openai-completions',
      provider: 'openai-codex',
      model: 'gpt-5.1-codex-mini',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'stop',
    },
  }) as SessionEntry;

const createUserEntry = (id: string, content: string): SessionEntry =>
  ({
    type: 'message',
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role: 'user',
      content,
      timestamp: 0,
    },
  }) as SessionEntry;

describe('extractTouchedFiles', () => {
  it('extracts path-like arguments from assistant tool calls', () => {
    const entries: SessionEntry[] = [
      createAssistantToolCallEntry('1', 'read', {
        path: 'src/index.ts',
      }),
      createAssistantToolCallEntry('2', 'find', {
        paths: ['src/components/Button.tsx', 'src/index.ts'],
      }),
      createAssistantToolCallEntry('3', 'bash', {
        command: 'pwd',
      }),
    ];

    expect(extractTouchedFiles(entries)).toEqual([
      'src/index.ts',
      'src/components/Button.tsx',
    ]);
  });
});

describe('buildHandoffContextPayload', () => {
  it('collects conversation text, stats, and touched files', () => {
    const entries: SessionEntry[] = [
      createUserEntry('1', 'Need a handoff command'),
      createAssistantToolCallEntry('2', 'read', {
        path: 'agent/extensions/sessions/session-index/src/index.ts',
      }),
      {
        type: 'message',
        id: '3',
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Implemented an initial version.' }],
          timestamp: 0,
          api: 'openai-completions',
          provider: 'openai-codex',
          model: 'gpt-5.1-codex-mini',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
        },
      } as SessionEntry,
    ];

    const payload = buildHandoffContextPayload(entries, 20_000);

    expect(payload.conversationText).toContain('User: Need a handoff command');
    expect(payload.stats.userMessageCount).toBe(1);
    expect(payload.stats.assistantMessageCount).toBe(2);
    expect(payload.stats.toolCallCount).toBe(1);
    expect(payload.touchedFiles).toEqual([
      'agent/extensions/sessions/session-index/src/index.ts',
    ]);
  });
});
