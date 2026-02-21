import { describe, expect, it } from 'vitest';
import { resolveSessionReference } from './query-resolve';
import type { DiscoveredSession } from './types';

const sessions: DiscoveredSession[] = [
  {
    sessionId: '11111111-1111-4111-8111-111111111111',
    sessionFile: '/tmp/a.jsonl',
    displayName: 'Checkout refactor',
    source: 'file',
  },
  {
    sessionId: '22222222-2222-4222-8222-222222222222',
    sessionFile: '/tmp/b.jsonl',
    displayName: 'Auth cleanup',
    source: 'meta',
  },
];

describe('resolveSessionReference', () => {
  it('resolves by exact session id', () => {
    const result = resolveSessionReference(
      sessions,
      '11111111-1111-4111-8111-111111111111'
    );

    expect(result).toEqual({
      ok: true,
      value: {
        ...sessions[0],
        resolvedBy: 'id',
      },
    });
  });

  it('resolves by exact name case-insensitively', () => {
    const result = resolveSessionReference(sessions, 'auth CLEANUP');

    expect(result).toEqual({
      ok: true,
      value: {
        ...sessions[1],
        resolvedBy: 'name-exact',
      },
    });
  });

  it('returns ambiguity details for duplicate exact names', () => {
    const duplicate: DiscoveredSession[] = [
      sessions[0],
      {
        sessionId: '33333333-3333-4333-8333-333333333333',
        sessionFile: '/tmp/c.jsonl',
        displayName: 'Checkout refactor',
        source: 'file',
      },
    ];

    const result = resolveSessionReference(duplicate, 'checkout refactor');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected resolution failure');
    }

    expect(result.error.code).toBe('SESSION_AMBIGUOUS');

    if (result.error.code !== 'SESSION_AMBIGUOUS') {
      throw new Error('Expected ambiguous resolution error');
    }

    expect(
      result.error.candidates.map(candidate => candidate.sessionId)
    ).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ]);
  });

  it('returns not found when no match exists', () => {
    const result = resolveSessionReference(sessions, 'missing-session');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'SESSION_NOT_FOUND',
        session: 'missing-session',
      },
    });
  });

  it('works with file-only discovery data (no sessions-meta)', () => {
    const fileOnly: DiscoveredSession[] = [
      {
        sessionId: '44444444-4444-4444-8444-444444444444',
        sessionFile: '/tmp/d.jsonl',
        displayName: 'From file label',
        source: 'file',
      },
    ];

    const result = resolveSessionReference(fileOnly, 'From file label');

    expect(result).toEqual({
      ok: true,
      value: {
        ...fileOnly[0],
        resolvedBy: 'name-exact',
      },
    });
  });
});
