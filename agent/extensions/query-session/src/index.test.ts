import { describe, expect, it, vi } from 'vitest';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';

const registerQuerySessionTool = vi.fn();
const resolveQueryModelAvailability = vi.fn();

vi.mock('./query-session', () => ({
  registerQuerySessionTool,
}));

vi.mock('./query-generate', () => ({
  resolveQueryModelAvailability,
}));

const createCtx = (): ExtensionContext =>
  ({
    ui: {
      notify: vi.fn(),
    },
    modelRegistry: {
      getAvailable: () => [],
      getApiKey: async () => undefined,
    },
  }) as unknown as ExtensionContext;

describe('setupQuerySessionExtension', () => {
  it('resets the per-turn counter on agent_start and injects instruction when operational', async () => {
    const handlers = new Map<
      string,
      Array<(event: unknown, ctx: ExtensionContext) => unknown>
    >();

    const pi = {
      on: (
        event: string,
        handler: (event: unknown, ctx: ExtensionContext) => unknown
      ) => {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
      },
    } as unknown as ExtensionAPI;

    resolveQueryModelAvailability.mockResolvedValue({
      selected: {
        model: {
          provider: 'google',
          id: 'gemini-2.5-flash',
          input: ['text'],
        },
        apiKey: undefined,
      },
      missingModelKeys: [],
    });

    const setupModule = await import('./index');
    setupModule.default(pi);

    expect(registerQuerySessionTool).toHaveBeenCalledTimes(1);

    const callCounter = registerQuerySessionTool.mock.calls[0]?.[2] as {
      count: number;
    };

    callCounter.count = 5;

    const agentStartHandler = handlers.get('agent_start')?.[0];
    expect(agentStartHandler).toBeDefined();

    agentStartHandler?.({ type: 'agent_start' }, createCtx());
    expect(callCounter.count).toBe(0);

    const sessionStartHandler = handlers.get('session_start')?.[0];
    await sessionStartHandler?.({ type: 'session_start' }, createCtx());

    const beforeAgentStartHandler = handlers.get('before_agent_start')?.[0];
    const result = beforeAgentStartHandler?.(
      {
        type: 'before_agent_start',
        prompt: 'question',
        systemPrompt: 'base-system',
      },
      createCtx()
    ) as { systemPrompt: string } | undefined;

    expect(result?.systemPrompt).toContain('base-system');
    expect(result?.systemPrompt).toContain('query_session');
  });
});
