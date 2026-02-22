import { describe, expect, it } from 'vitest';
import { parseSessionReferences } from './parse';

describe('parseSessionReferences', () => {
  it('extracts unique UUID references preserving order', () => {
    const result = parseSessionReferences(
      [
        'check @@11111111-1111-1111-1111-111111111111 and',
        '@@22222222-2222-2222-2222-222222222222 and duplicate',
        '@@11111111-1111-1111-1111-111111111111',
      ].join(' '),
      3
    );

    expect(result).toEqual({
      references: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      overLimitCount: 0,
    });
  });

  it('ignores non-uuid references', () => {
    const result = parseSessionReferences(
      'see @@not-a-session and @@33333333-3333-3333-3333-333333333333',
      3
    );

    expect(result).toEqual({
      references: ['33333333-3333-3333-3333-333333333333'],
      overLimitCount: 0,
    });
  });

  it('enforces max reference count', () => {
    const result = parseSessionReferences(
      [
        '@@11111111-1111-1111-1111-111111111111',
        '@@22222222-2222-2222-2222-222222222222',
        '@@33333333-3333-3333-3333-333333333333',
      ].join(' '),
      2
    );

    expect(result).toEqual({
      references: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
      overLimitCount: 1,
    });
  });
});
