import { describe, expect, it, vi } from 'vitest';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';

const parseSessionReferences = vi.fn();
const resolveSessionReferences = vi.fn();
const buildInjectionPayload = vi.fn();

vi.mock('./parse', () => ({
  parseSessionReferences,
}));

vi.mock('./resolve', () => ({
  resolveSessionReferences,
  SESSION_REFERENCE_ERROR_CODES: {
    notFound: 'not_found',
    invalidMeta: 'invalid_meta',
    overLimit: 'over_limit',
  },
}));

vi.mock('./inject', () => ({
  buildInjectionPayload,
}));

const createCtx = (): ExtensionContext =>
  ({
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: {
        fg: (_tone: string, message: string) => message,
      },
    },
  }) as unknown as ExtensionContext;

const createPi = () => {
  const handlers = new Map<
    string,
    Array<(event: unknown, ctx: ExtensionContext) => unknown>
  >();
  const appendEntry = vi.fn();

  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown
    ) => {
      const current = handlers.get(event) ?? [];
      current.push(handler);
      handlers.set(event, current);
    },
    appendEntry,
  } as unknown as ExtensionAPI;

  return {
    handlers,
    appendEntry,
    pi,
  };
};

describe('setupSessionReferenceExtension', () => {
  it('injects custom message when references resolve', async () => {
    const { handlers, appendEntry, pi } = createPi();

    parseSessionReferences.mockReturnValue({
      references: ['11111111-1111-1111-1111-111111111111'],
      overLimitCount: 0,
    });
    resolveSessionReferences.mockResolvedValue({
      resolved: [
        {
          sessionId: '11111111-1111-1111-1111-111111111111',
          meta: {
            schemaVersion: 1,
            sessionId: '11111111-1111-1111-1111-111111111111',
            sessionFile: '/tmp/a.jsonl',
            name: 'A',
            description: 'B',
            summary: 'C',
            tags: ['x'],
            cwd: '/tmp',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            model: 'openai-codex/gpt-5.1-codex-mini',
            lastIndexedLeafId: 'leaf',
          },
        },
      ],
      unresolved: [],
    });
    buildInjectionPayload.mockReturnValue({
      content: 'payload',
      injectedBytes: 7,
      truncated: false,
    });

    const setupModule = await import('./index');
    setupModule.setupSessionReferenceExtension(pi);

    const beforeAgentStartHandler = handlers.get('before_agent_start')?.[0];
    const result = (await beforeAgentStartHandler?.(
      {
        type: 'before_agent_start',
        prompt: '@@11111111-1111-1111-1111-111111111111',
      },
      createCtx()
    )) as {
      message: { content: string; display: boolean; customType: string };
    };

    expect(result.message.customType).toBe('session-reference');
    expect(result.message.content).toBe('payload');
    expect(result.message.display).toBe(false);

    expect(appendEntry).toHaveBeenCalledWith(
      'session-reference:inject',
      expect.objectContaining({
        success: true,
        resolvedCount: 1,
        unresolvedCount: 0,
        injectedBytes: 7,
        truncated: false,
      })
    );
  });

  it('does not inject when all references fail', async () => {
    const { handlers, appendEntry, pi } = createPi();

    parseSessionReferences.mockReturnValue({
      references: ['11111111-1111-1111-1111-111111111111'],
      overLimitCount: 0,
    });
    resolveSessionReferences.mockResolvedValue({
      resolved: [],
      unresolved: [
        {
          sessionId: '11111111-1111-1111-1111-111111111111',
          reason: 'not_found',
        },
      ],
    });

    const setupModule = await import('./index');
    setupModule.setupSessionReferenceExtension(pi);

    const beforeAgentStartHandler = handlers.get('before_agent_start')?.[0];
    const result = await beforeAgentStartHandler?.(
      {
        type: 'before_agent_start',
        prompt: '@@11111111-1111-1111-1111-111111111111',
      },
      createCtx()
    );

    expect(result).toBeUndefined();
    expect(appendEntry).toHaveBeenCalledWith(
      'session-reference:inject',
      expect.objectContaining({
        success: false,
        resolvedCount: 0,
        unresolvedCount: 1,
        injectedBytes: 0,
        truncated: false,
      })
    );
  });
});
