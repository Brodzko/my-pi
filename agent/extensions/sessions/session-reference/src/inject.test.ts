import { describe, expect, it } from 'vitest';
import { buildInjectionPayload } from './inject';
import type { ResolvedSessionReference } from './resolve';

const createResolved = (
  sessionId: string,
  summary: string
): ResolvedSessionReference => ({
  sessionId,
  meta: {
    schemaVersion: 1,
    sessionId,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    name: `Session ${sessionId.slice(0, 4)}`,
    description: 'Description',
    summary,
    tags: ['a', 'b'],
    cwd: '/tmp',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    model: 'openai-codex/gpt-5.1-codex-mini',
    lastIndexedLeafId: 'leaf-1',
  },
});

describe('buildInjectionPayload', () => {
  it('renders aggregated content for resolved references', () => {
    const payload = buildInjectionPayload(
      [
        createResolved('11111111-1111-1111-1111-111111111111', 'Summary one'),
        createResolved('22222222-2222-2222-2222-222222222222', 'Summary two'),
      ],
      12_000
    );

    expect(payload.truncated).toBe(false);
    expect(payload.content).toContain('Referenced session summaries:');
    expect(payload.content).toContain('Summary one');
    expect(payload.content).toContain('Summary two');
    expect(payload.injectedBytes).toBeGreaterThan(0);
  });

  it('truncates when payload exceeds byte budget', () => {
    const payload = buildInjectionPayload(
      [
        createResolved(
          '11111111-1111-1111-1111-111111111111',
          'x'.repeat(10_000)
        ),
      ],
      120
    );

    expect(payload.truncated).toBe(true);
    expect(payload.content).toContain('[truncated to fit maxInjectedBytes]');
    expect(payload.injectedBytes).toBeLessThanOrEqual(120);
  });
});
