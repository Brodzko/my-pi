import Fuse from 'fuse.js';
import path from 'path';

/** Inclusive [start, end] character index range within `item`. */
export type HighlightRange = readonly [number, number];

export type FuzzyResult = {
  item: string;
  /** Original index in the input items array — used for sessions lookup. */
  refIndex: number;
  /** Sorted, non-overlapping ranges of matched characters within `item`. */
  highlights: readonly HighlightRange[];
};

// Static — extracted so it isn't reconstructed on every call.
const FUSE_OPTIONS = {
  includeMatches: true,
  includeScore: true,
  threshold: 0.4,
  minMatchCharLength: 1,
  keys: [
    // Basename gets more weight so typing a filename beats typing a dir prefix.
    { name: 'name', getFn: (s: string) => path.basename(s), weight: 0.7 },
    { name: 'path', getFn: (s: string) => s, weight: 0.3 },
  ],
};

/** Merge overlapping or adjacent ranges into a sorted, non-overlapping list. */
const mergeRanges = (ranges: readonly HighlightRange[]): HighlightRange[] =>
  [...ranges]
    .sort(([a], [b]) => a - b)
    .reduce<HighlightRange[]>((acc, [s, e]) => {
      const last = acc.at(-1);
      return last && s <= last[1] + 1
        ? [
            ...acc.slice(0, -1),
            [last[0], Math.max(last[1], e)] as HighlightRange,
          ]
        : [...acc, [s, e]];
    }, []);

export const fuzzySearch = (query: string, items: string[]): FuzzyResult[] => {
  if (!query.trim()) {
    return items.map((item, refIndex) => ({ item, refIndex, highlights: [] }));
  }

  return new Fuse(items, FUSE_OPTIONS)
    .search(query)
    .map(({ item, refIndex, matches }) => {
      // match.indices are relative to the matched field value, so "name" key
      // matches (against basename) need to be offset to the full path position.
      const basenameOffset = item.length - path.basename(item).length;

      const raw = (matches ?? []).flatMap(({ key, indices }) => {
        if (!indices) return [];
        const offset = key === 'name' ? basenameOffset : 0;
        return indices
          .map(([s, e]): [number, number] => [s + offset, e + offset])
          .filter(([s, e]) => s >= 0 && e < item.length);
      });

      return { item, refIndex, highlights: mergeRanges(raw) };
    });
};
