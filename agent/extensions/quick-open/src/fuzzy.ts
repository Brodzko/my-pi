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
    // Prioritize filename stem over extension/path for more intuitive ranking.
    {
      name: 'stem',
      getFn: (s: string) => path.basename(s, path.extname(s)),
      weight: 0.75,
    },
    { name: 'name', getFn: (s: string) => path.basename(s), weight: 0.15 },
    { name: 'path', getFn: (s: string) => s, weight: 0.1 },
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

const computeRank = (
  query: string,
  item: string,
  fuseScore: number | undefined
): number => {
  const normalizedQuery = query.trim().toLowerCase();
  const basename = path.basename(item).toLowerCase();
  const stem = path.basename(item, path.extname(item)).toLowerCase();

  let rank = fuseScore ?? 1;

  if (stem === normalizedQuery) rank -= 0.4;
  if (basename === normalizedQuery) rank -= 0.25;
  if (stem.startsWith(normalizedQuery)) rank -= 0.15;
  if (basename.startsWith(normalizedQuery)) rank -= 0.08;

  const singularQuery =
    normalizedQuery.endsWith('s') && normalizedQuery.length > 1
      ? normalizedQuery.slice(0, -1)
      : normalizedQuery;
  const pluralQuery = normalizedQuery.endsWith('s')
    ? normalizedQuery
    : `${normalizedQuery}s`;

  if (stem === singularQuery && singularQuery !== normalizedQuery) rank -= 0.2;
  if (stem === pluralQuery && pluralQuery !== normalizedQuery) rank -= 0.15;

  // Slightly penalize matches that only hit the extension part of the basename.
  if (!stem.includes(normalizedQuery) && basename.includes(normalizedQuery)) {
    rank += 0.08;
  }

  return rank;
};

export const fuzzySearch = (query: string, items: string[]): FuzzyResult[] => {
  if (!query.trim()) {
    return items.map((item, refIndex) => ({ item, refIndex, highlights: [] }));
  }

  return new Fuse(items, FUSE_OPTIONS)
    .search(query)
    .sort(
      (a, b) =>
        computeRank(query, a.item, a.score) -
        computeRank(query, b.item, b.score)
    )
    .map(({ item, refIndex, matches }) => {
      // match.indices are relative to the matched field value, so "name" and
      // "stem" keys (both basename-based) need to be offset to full path.
      const basenameOffset = item.length - path.basename(item).length;

      const raw = (matches ?? []).flatMap(({ key, indices }) => {
        if (!indices) return [];
        const offset = key === 'name' || key === 'stem' ? basenameOffset : 0;
        return indices
          .map(([s, e]): [number, number] => [s + offset, e + offset])
          .filter(([s, e]) => s >= 0 && e < item.length);
      });

      return { item, refIndex, highlights: mergeRanges(raw) };
    });
};
