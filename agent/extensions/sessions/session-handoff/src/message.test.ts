import { describe, expect, it } from 'vitest';
import { composeHandoffPrefill } from './message';

describe('composeHandoffPrefill', () => {
  it('always appends query_session guidance', () => {
    const result = composeHandoffPrefill(
      '## Goal\n- Finish implementation',
      ''
    );

    expect(result).toContain('## Additional Context Retrieval');
    expect(result).toContain('`query_session`');
  });

  it('appends optional instruction when provided', () => {
    const result = composeHandoffPrefill(
      '## Goal\n- Finish implementation',
      'Run lint before coding.'
    );

    expect(result).toContain('## Additional Instruction');
    expect(result).toContain('Run lint before coding.');
  });

  it('includes source session ID in guidance when provided', () => {
    const sessionId = '2f3d4a1e-bb34-40c0-8c2e-6b7faa12783b';
    const result = composeHandoffPrefill(
      '## Goal\n- Finish implementation',
      '',
      sessionId
    );

    expect(result).toContain(`handed off from session \`${sessionId}\``);
    expect(result).toContain(`session: "${sessionId}"`);
  });

  it('uses generic guidance when no source session ID is provided', () => {
    const result = composeHandoffPrefill(
      '## Goal\n- Finish implementation',
      ''
    );

    expect(result).not.toContain('handed off from session');
    expect(result).toContain('session UUID');
  });
});
