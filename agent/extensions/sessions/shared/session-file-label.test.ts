import { describe, expect, it } from 'vitest';
import { parseSessionFileLabel } from '../../shared/session-file-label';

describe('parseSessionFileLabel', () => {
  it('prefers explicit session id and session_info name', () => {
    const parsed = parseSessionFileLabel(
      [
        JSON.stringify({
          type: 'session',
          id: '11111111-1111-4111-8111-111111111111',
        }),
        JSON.stringify({
          type: 'session_info',
          name: ' Planning migration ',
        }),
        JSON.stringify({
          type: 'message',
          message: {
            role: 'user',
            content: 'fallback prompt',
          },
        }),
      ].join('\n'),
      '2026-02-20_demo_stem'
    );

    expect(parsed).toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Planning migration',
      hasName: true,
    });
  });

  it('falls back to first user text and then stem-derived session id', () => {
    const parsed = parseSessionFileLabel(
      [
        JSON.stringify({
          type: 'message',
          message: {
            role: 'user',
            content: [{ type: 'text', text: '  First user prompt  ' }],
          },
        }),
      ].join('\n'),
      '2026-02-20_demo_22222222-2222-4222-8222-222222222222'
    );

    expect(parsed).toEqual({
      sessionId: '22222222-2222-4222-8222-222222222222',
      displayName: 'First user prompt',
      hasName: false,
    });
  });

  it('uses configurable first-user-text truncation', () => {
    const parsed = parseSessionFileLabel(
      [
        JSON.stringify({
          type: 'message',
          message: {
            role: 'user',
            content: 'abcdefghijklmnopqrstuvwxyz',
          },
        }),
      ].join('\n'),
      'fallback-stem',
      {
        firstUserTextMaxChars: 6,
      }
    );

    expect(parsed).toEqual({
      sessionId: 'fallback-stem',
      displayName: 'abcdef',
      hasName: false,
    });
  });
});
