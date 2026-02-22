import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, AssistantMessage, Model, Usage } from '@mariozechner/pi-ai';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { complete } from '@mariozechner/pi-ai';
import { generateQueryAnswer, QueryGenerateError } from './query-generate';
import type { QuerySessionConfig } from './types';

vi.mock('@mariozechner/pi-ai', async importOriginal => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();

  return {
    ...actual,
    complete: vi.fn(),
  };
});

const mockComplete = vi.mocked(complete);

const usage: Usage = {
  input: 100,
  output: 50,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 150,
  cost: {
    input: 0.001,
    output: 0.002,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.003,
  },
};

const createAssistantMessage = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-responses',
  provider: 'openai',
  model: 'gpt-test',
  usage,
  stopReason: 'stop',
  timestamp: Date.now(),
});

const model = {
  provider: 'google',
  id: 'gemini-2.5-flash',
  input: ['text'],
} as unknown as Model<Api>;

const createCtx = (): ExtensionContext =>
  ({
    modelRegistry: {
      getAvailable: () => [model],
      getApiKey: async () => undefined,
    },
  }) as unknown as ExtensionContext;

const config: QuerySessionConfig = {
  enabled: true,
  statusKey: 'query-session',
  notificationAutoClearMs: 3000,
  modelKeys: ['google/gemini-2.5-flash'],
  maxBytes: 160_000,
  maxCallsPerTurn: 1,
  timeoutMs: 15_000,
  useSessionsMeta: true,
};

describe('generateQueryAnswer', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it('parses valid JSON model output', async () => {
    mockComplete.mockResolvedValueOnce(
      createAssistantMessage(
        JSON.stringify({
          answerMarkdown: 'We decided to keep retries linear.',
          confidence: 'high',
          citations: [
            {
              entryId: 'msg-1',
              role: 'assistant',
              excerpt: 'We should keep retries linear.',
            },
          ],
        })
      )
    );

    const result = await generateQueryAnswer({
      ctx: createCtx(),
      config,
      conversationText: '[msg-1] Assistant: We should keep retries linear.',
      question: 'What did we decide about retries?',
    });

    expect(result.output.answerMarkdown).toContain('retries linear');
    expect(result.output.confidence).toBe('high');
    expect(result.model).toBe('google/gemini-2.5-flash');
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('retries malformed output and fails after max retries', async () => {
    mockComplete.mockResolvedValue(
      createAssistantMessage('this is not valid json output')
    );

    await expect(
      generateQueryAnswer({
        ctx: createCtx(),
        config,
        conversationText: 'Conversation text',
        question: 'Question',
      })
    ).rejects.toMatchObject({
      kind: 'malformed_output',
    } satisfies Partial<QueryGenerateError>);

    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  it('does not retry provider/transport errors', async () => {
    mockComplete.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      generateQueryAnswer({
        ctx: createCtx(),
        config,
        conversationText: 'Conversation text',
        question: 'Question',
      })
    ).rejects.toMatchObject({
      kind: 'transport',
      message: 'provider unavailable',
    } satisfies Partial<QueryGenerateError>);

    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
