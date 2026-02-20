import { describe, expect, it } from 'vitest';
import { fuzzySearch } from './fuzzy';

describe('fuzzySearch', () => {
  it('returns original order when query is empty', () => {
    const items = ['b/file.ts', 'a/file.ts'];

    const results = fuzzySearch('', items);

    expect(results.map(result => result.item)).toEqual(items);
  });

  it('prioritizes filename stem over path-only matches', () => {
    const items = [
      'docs/archive/sessions-notes.md',
      'src/session.ts',
      'nested/deep/path/for/sessions/reference.txt',
    ];

    const results = fuzzySearch('session', items);

    expect(results[0]?.item).toBe('src/session.ts');
  });

  it('keeps singular/plural filename matches near the top', () => {
    const items = ['src/session.ts', 'src/sessions-helper.ts', 'notes/misc.md'];

    const results = fuzzySearch('sessions', items);

    expect(results.slice(0, 2).map(result => result.item)).toContain(
      'src/session.ts'
    );
  });
});
