import { describe, expect, it, vi } from 'vitest';
import type {
  ExtensionAPI,
  ExtensionContext,
  FileEntry,
} from '@mariozechner/pi-coding-agent';
import { createQuerySessionExecutor } from './query-session-executor';
import type { QuerySessionConfig, ResolvedSession } from './types';

const createConfig = (
  overrides: Partial<QuerySessionConfig>
): QuerySessionConfig => ({
  enabled: true,
  statusKey: 'query-session',
  notificationAutoClearMs: 3000,
  modelKeys: ['google/gemini-2.5-flash'],
  maxBytes: 160_000,
  maxCallsPerTurn: 1,
  timeoutMs: 15_000,
  useSessionsMeta: true,
  ...overrides,
});

const createCtx = (): ExtensionContext =>
  ({
    ui: {
      theme: {
        fg: (_tone: string, text: string) => text,
      },
      setStatus: () => undefined,
    },
  }) as unknown as ExtensionContext;

const resolvedSession: ResolvedSession = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  sessionFile: '/tmp/test.jsonl',
  displayName: 'Checkout refactor',
  source: 'file',
  resolvedBy: 'id',
};

const parsedEntries: FileEntry[] = [
  {
    type: 'session',
    id: resolvedSession.sessionId,
    timestamp: new Date(0).toISOString(),
    cwd: '/tmp',
  },
  {
    type: 'message',
    id: 'u1',
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Should we keep linear retries?' }],
      timestamp: 0,
    },
  },
  {
    type: 'message',
    id: 'u2',
    parentId: 'u1',
    timestamp: new Date(0).toISOString(),
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Yes, we kept retries linear.' }],
      timestamp: 0,
    },
  },
];

const createPi = (): ExtensionAPI =>
  ({
    appendEntry: vi.fn(),
  }) as unknown as ExtensionAPI;

const createDependencies = () => {
  const start = vi.fn();
  const success = vi.fn();
  const failure = vi.fn();

  return {
    discoverSessions: vi.fn().mockResolvedValue([resolvedSession]),
    collectRelatedSessions: vi.fn().mockResolvedValue([resolvedSession]),
    generateQueryAnswer: vi.fn().mockResolvedValue({
      output: {
        answerMarkdown: 'We decided to keep retries linear.',
        confidence: 'high',
      },
      usage: {
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
      },
      model: 'google/gemini-2.5-flash',
    }),
    serializeConversation: vi.fn().mockReturnValue({
      conversationText: '[u1] User: Should we keep linear retries?',
      serializedBytes: 42,
      truncated: false,
    }),
    createStatusNotifier: vi.fn().mockReturnValue({
      start,
      success,
      failure,
    }),
    parseSessionEntries: vi.fn().mockReturnValue(parsedEntries),
    readFile: vi.fn().mockResolvedValue('session-content'),
    now: vi
      .fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValue(1_500),
    statusSpies: {
      start,
      success,
      failure,
    },
  };
};

describe('createQuerySessionExecutor', () => {
  it('returns a validated result and appends success telemetry', async () => {
    const pi = createPi();
    const callCounter = { count: 0 };
    const deps = createDependencies();

    const execute = createQuerySessionExecutor(
      pi,
      createConfig({}),
      callCounter,
      deps
    );

    const result = await execute(
      {
        session: resolvedSession.sessionId,
        question: 'What did we decide?',
      },
      createCtx()
    );

    expect(result.answerMarkdown).toContain('retries linear');
    expect(deps.statusSpies.start).toHaveBeenCalledTimes(1);
    expect(deps.statusSpies.success).toHaveBeenCalledTimes(1);
    expect(deps.statusSpies.failure).not.toHaveBeenCalled();

    const appendEntry = vi.mocked(pi.appendEntry);
    expect(appendEntry).toHaveBeenCalledTimes(1);
    expect(appendEntry.mock.calls[0]?.[0]).toBe('query-session:query_session');

    const telemetry = appendEntry.mock.calls[0]?.[1] as {
      success: boolean;
      usage?: { cost: { total: number } };
    };

    expect(telemetry.success).toBe(true);
    expect(telemetry.usage?.cost.total).toBe(0.003);
  });

  it('maps resolver failures to structured tool errors and appends failure telemetry', async () => {
    const pi = createPi();
    const callCounter = { count: 0 };
    const deps = createDependencies();
    deps.discoverSessions.mockResolvedValueOnce([]);

    const execute = createQuerySessionExecutor(
      pi,
      createConfig({}),
      callCounter,
      deps
    );

    await expect(
      execute(
        {
          session: 'missing-session',
          question: 'Question',
        },
        createCtx()
      )
    ).rejects.toThrow(/SESSION_NOT_FOUND/);

    expect(deps.statusSpies.start).toHaveBeenCalledTimes(1);
    expect(deps.statusSpies.failure).toHaveBeenCalledTimes(1);

    const appendEntry = vi.mocked(pi.appendEntry);
    expect(appendEntry).toHaveBeenCalledTimes(1);

    const telemetry = appendEntry.mock.calls[0]?.[1] as { success: boolean };
    expect(telemetry.success).toBe(false);
  });

  it('enforces max calls per turn and records the limit failure', async () => {
    const pi = createPi();
    const callCounter = { count: 0 };
    const deps = createDependencies();

    const execute = createQuerySessionExecutor(
      pi,
      createConfig({ maxCallsPerTurn: 1 }),
      callCounter,
      deps
    );

    await execute(
      {
        session: resolvedSession.sessionId,
        question: 'First question',
      },
      createCtx()
    );

    await expect(
      execute(
        {
          session: resolvedSession.sessionId,
          question: 'Second question',
        },
        createCtx()
      )
    ).rejects.toThrow(/CALL_LIMIT_EXCEEDED/);

    const appendEntry = vi.mocked(pi.appendEntry);
    expect(appendEntry).toHaveBeenCalledTimes(2);

    const secondTelemetry = appendEntry.mock.calls[1]?.[1] as {
      success: boolean;
      error?: string;
    };

    expect(secondTelemetry.success).toBe(false);
    expect(secondTelemetry.error).toContain('CALL_LIMIT_EXCEEDED');
  });
});
