import { describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createStatusNotifier } from './status';
import type { QuerySessionConfig } from './types';

const createConfig = (): QuerySessionConfig => ({
  enabled: true,
  statusKey: 'query-session',
  notificationAutoClearMs: 100,
  modelKeys: ['google/gemini-2.5-flash'],
  maxBytes: 160_000,
  maxCallsPerTurn: 1,
  timeoutMs: 15_000,
  useSessionsMeta: true,
});

const createCtx = (setStatus: ReturnType<typeof vi.fn>): ExtensionContext =>
  ({
    ui: {
      setStatus,
      theme: {
        fg: (_tone: string, text: string) => text,
      },
    },
  }) as unknown as ExtensionContext;

describe('createStatusNotifier', () => {
  it('transitions start -> success/failure and auto-clears', () => {
    vi.useFakeTimers();

    const setStatus = vi.fn();
    const notifier = createStatusNotifier(createCtx(setStatus), createConfig());

    notifier.start();
    notifier.success(0.0034);

    expect(setStatus).toHaveBeenNthCalledWith(
      1,
      'query-session',
      'querying another session...'
    );
    expect(setStatus).toHaveBeenNthCalledWith(
      2,
      'query-session',
      'query_session done ($0.003400)'
    );

    vi.advanceTimersByTime(100);

    expect(setStatus).toHaveBeenNthCalledWith(3, 'query-session', undefined);

    notifier.failure('network issue');
    expect(setStatus).toHaveBeenNthCalledWith(
      4,
      'query-session',
      'query_session failed: network issue'
    );

    vi.advanceTimersByTime(100);
    expect(setStatus).toHaveBeenNthCalledWith(5, 'query-session', undefined);

    vi.useRealTimers();
  });
});
