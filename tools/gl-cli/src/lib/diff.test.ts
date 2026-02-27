import { describe, it, expect } from 'vitest';
import { parseDiffLineRanges, isLineInDiff } from './diff.js';

const sampleDiff = `@@ -10,6 +10,8 @@ some context
 context line
 context line
+added line 12
+added line 13
 context line
-removed line 14
 context line
@@ -30,3 +31,5 @@ more context
 context
+added line 32
+added line 33
 context`;

describe('parseDiffLineRanges', () => {
  it('finds new line ranges (added lines)', () => {
    const ranges = parseDiffLineRanges(sampleDiff, 'new');
    expect(ranges).toEqual([
      { start: 12, end: 13 },
      { start: 32, end: 33 },
    ]);
  });

  it('finds old line ranges (removed lines)', () => {
    const ranges = parseDiffLineRanges(sampleDiff, 'old');
    // After @@ -10,6 +10,8 @@: 2 context (old 10,11), 2 added (no old), 1 context (old 12), then removed at old 13
    expect(ranges).toEqual([{ start: 13, end: 13 }]);
  });
});

describe('isLineInDiff', () => {
  it('returns true for lines in added ranges', () => {
    expect(isLineInDiff(sampleDiff, 12, 'new')).toBe(true);
    expect(isLineInDiff(sampleDiff, 13, 'new')).toBe(true);
    expect(isLineInDiff(sampleDiff, 32, 'new')).toBe(true);
  });

  it('returns false for context lines', () => {
    expect(isLineInDiff(sampleDiff, 10, 'new')).toBe(false);
    expect(isLineInDiff(sampleDiff, 11, 'new')).toBe(false);
  });

  it('returns false for lines outside diff', () => {
    expect(isLineInDiff(sampleDiff, 1, 'new')).toBe(false);
    expect(isLineInDiff(sampleDiff, 100, 'new')).toBe(false);
  });

  it('returns true for removed lines in old type', () => {
    expect(isLineInDiff(sampleDiff, 13, 'old')).toBe(true);
  });

  it('returns false for non-removed old lines', () => {
    expect(isLineInDiff(sampleDiff, 10, 'old')).toBe(false);
  });
});
