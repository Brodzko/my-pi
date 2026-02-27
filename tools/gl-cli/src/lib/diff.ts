export type ValidRange = { start: number; end: number };

/**
 * Parse diff hunks to find valid line ranges for a given line type.
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
