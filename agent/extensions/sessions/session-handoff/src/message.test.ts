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
});
