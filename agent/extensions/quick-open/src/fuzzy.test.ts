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

  it('treats separators in query as mostly irrelevant', () => {
    const items = [
      'src/session-query.ts',
      'src/sessionquery.ts',
      'docs/some-other-file.md',
    ];

    const compact = fuzzySearch('sessionquery', items).map(
      result => result.item
    );
    const separated = fuzzySearch('session-query', items).map(
      result => result.item
    );

    expect(separated.slice(0, 2)).toEqual(compact.slice(0, 2));
  });

  it('prioritizes entries that match all query terms', () => {
    const items = [
      'agent/extensions/quick-open/src/fuzzy.ts',
      'agent/extensions/quick-open/src/dialog.ts',
      'agent/extensions/other/src/fuzzy.ts',
    ];

    const results = fuzzySearch('quickopen fuzzy', items);

    expect(results[0]?.item).toBe('agent/extensions/quick-open/src/fuzzy.ts');
  });

  it('does not treat weak fuzzy hits as full token coverage', () => {
    const items = [
      'agent/extensions/sessions/session-index/src',
      'agent/extensions/sessions/session-index/src/config.ts',
    ];

    const results = fuzzySearch('session src conf', items);

    expect(results[0]?.item).toBe(
      'agent/extensions/sessions/session-index/src/config.ts'
    );
  });
});
