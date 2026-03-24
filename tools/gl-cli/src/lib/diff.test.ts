import { describe, it, expect } from 'vitest';
import {
  parseDiffLineRanges,
  parseDiffVisibleRanges,
  isLineInDiff,
  isLineVisibleInDiff,
} from './diff.js';

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

describe('parseDiffVisibleRanges', () => {
  it('includes context and added lines for new type', () => {
    const ranges = parseDiffVisibleRanges(sampleDiff, 'new');
    // First hunk: context(10), context(11), +added(12), +added(13), context(14), context(15) -> 10-15
    // Second hunk: context(31), +added(32), +added(33), context(34) -> 31-34
    expect(ranges).toEqual([
      { start: 10, end: 15 },
      { start: 31, end: 34 },
    ]);
  });

  it('includes context and removed lines for old type', () => {
    const ranges = parseDiffVisibleRanges(sampleDiff, 'old');
    // First hunk: context(10), context(11), +skip, +skip, context(12), -removed(13), context(14) -> 10-14
    // Second hunk: context(30), +skip, +skip, context(31) -> 30-31
    expect(ranges).toEqual([
      { start: 10, end: 14 },
      { start: 30, end: 31 },
    ]);
  });
});

describe('isLineVisibleInDiff', () => {
  it('returns true for context lines on new side', () => {
    expect(isLineVisibleInDiff(sampleDiff, 10, 'new')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 11, 'new')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 14, 'new')).toBe(true);
  });

  it('returns true for added lines on new side', () => {
    expect(isLineVisibleInDiff(sampleDiff, 12, 'new')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 13, 'new')).toBe(true);
  });

  it('returns false for lines outside diff hunks', () => {
    expect(isLineVisibleInDiff(sampleDiff, 1, 'new')).toBe(false);
    expect(isLineVisibleInDiff(sampleDiff, 100, 'new')).toBe(false);
    expect(isLineVisibleInDiff(sampleDiff, 20, 'new')).toBe(false);
  });

  it('returns true for context lines on old side', () => {
    expect(isLineVisibleInDiff(sampleDiff, 10, 'old')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 11, 'old')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 12, 'old')).toBe(true);
    expect(isLineVisibleInDiff(sampleDiff, 14, 'old')).toBe(true);
  });

  it('returns true for removed lines on old side', () => {
    expect(isLineVisibleInDiff(sampleDiff, 13, 'old')).toBe(true);
  });

  it('returns false for lines outside diff hunks on old side', () => {
    expect(isLineVisibleInDiff(sampleDiff, 1, 'old')).toBe(false);
    expect(isLineVisibleInDiff(sampleDiff, 100, 'old')).toBe(false);
  });
});
