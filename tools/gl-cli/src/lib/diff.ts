export type ValidRange = { start: number; end: number };

/**
 * Parse diff hunks to find ranges of **changed** lines only.
 * For "new" lines: returns ranges of added lines (+ lines).
 * For "old" lines: returns ranges of removed lines (- lines).
 */
export const parseDiffLineRanges = (
  diff: string,
  lineType: 'new' | 'old'
): ValidRange[] => {
  const ranges: ValidRange[] = [];
  const lines = diff.split('\n');
  let newLine = 0;
  let oldLine = 0;
  let rangeStart: number | null = null;

  const closeRange = () => {
    if (rangeStart !== null) {
      const end = lineType === 'new' ? newLine - 1 : oldLine - 1;
      if (end >= rangeStart) {
        ranges.push({ start: rangeStart, end });
      }
      rangeStart = null;
    }
  };

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      closeRange();
      oldLine = parseInt(hunkMatch[1]!, 10);
      newLine = parseInt(hunkMatch[2]!, 10);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (lineType === 'new' && rangeStart === null) rangeStart = newLine;
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (lineType === 'old' && rangeStart === null) rangeStart = oldLine;
      oldLine++;
    } else if (!line.startsWith('\\')) {
      closeRange();
      newLine++;
      oldLine++;
    }
  }

  closeRange();
  return ranges;
};

/**
 * Parse diff hunks to find **all lines visible** in the diff (context + changed).
 * GitLab accepts line comments on any line present in the diff, not just changed lines.
 * For "new": returns ranges covering all new-side lines (context + added).
 * For "old": returns ranges covering all old-side lines (context + removed).
 *
 * Within a hunk, visible lines on a given side are always contiguous because:
 * - new side: context (new++) and added (new++) advance; removed lines don't touch new
 * - old side: context (old++) and removed (old++) advance; added lines don't touch old
 * So each hunk produces exactly one range per side.
 */
export const parseDiffVisibleRanges = (
  diff: string,
  lineType: 'new' | 'old'
): ValidRange[] => {
  const ranges: ValidRange[] = [];
  const lines = diff.split('\n');
  let newLine = 0;
  let oldLine = 0;
  let hunkStart: number | null = null;

  const tracker = () => (lineType === 'new' ? newLine : oldLine);

  const closeHunk = () => {
    if (hunkStart !== null) {
      const end = tracker() - 1;
      if (end >= hunkStart) {
        ranges.push({ start: hunkStart, end });
      }
      hunkStart = null;
    }
  };

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      closeHunk();
      oldLine = parseInt(hunkMatch[1]!, 10);
      newLine = parseInt(hunkMatch[2]!, 10);
      hunkStart = tracker();
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLine++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      oldLine++;
    } else if (!line.startsWith('\\')) {
      newLine++;
      oldLine++;
    }
  }

  closeHunk();
  return ranges;
};

export const isLineInRanges = (line: number, ranges: ValidRange[]): boolean =>
  ranges.some(r => line >= r.start && line <= r.end);

export const isLineInDiff = (
  diff: string,
  line: number,
  lineType: 'new' | 'old'
): boolean => {
  const ranges = parseDiffLineRanges(diff, lineType);
  return isLineInRanges(line, ranges);
};

/**
 * Check if a line is visible anywhere in the diff (context or changed).
 * Use this for validating line comment placement — GitLab accepts comments
 * on any line present in the diff, not just added/removed lines.
 */
export const isLineVisibleInDiff = (
  diff: string,
  line: number,
  lineType: 'new' | 'old'
): boolean => {
  const ranges = parseDiffVisibleRanges(diff, lineType);
  return isLineInRanges(line, ranges);
};
