import Fuse, { type FuseResultMatch } from 'fuse.js';
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

type MatchTokenState = {
  scoreSum: number;
  matchCount: number;
  tokenHits: Set<string>;
  ranges: HighlightRange[];
};

// Static — extracted so it isn't reconstructed on every call.
const normalizeSearchText = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const tokenizeQuery = (query: string): string[] => {
  const rawTerms = query
    .trim()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);

  const compactTerms = rawTerms.map(normalizeSearchText).filter(Boolean);
  return compactTerms.length > 0 ? compactTerms : rawTerms;
};

const FUSE_OPTIONS = {
  includeMatches: true,
  includeScore: true,
  threshold: 0.5,
  ignoreLocation: true,
  minMatchCharLength: 1,
  keys: [
    // Prioritize filename stem over extension/path for more intuitive ranking.
    {
      name: 'stem',
      getFn: (s: string) => path.basename(s, path.extname(s)),
      weight: 0.62,
    },
    { name: 'name', getFn: (s: string) => path.basename(s), weight: 0.16 },
    {
      name: 'compactName',
      getFn: (s: string) => normalizeSearchText(path.basename(s)),
      weight: 0.14,
    },
    { name: 'path', getFn: (s: string) => s, weight: 0.06 },
    {
      name: 'compactPath',
      getFn: (s: string) => normalizeSearchText(s),
      weight: 0.02,
    },
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

const extractRanges = (
  item: string,
  matches: ReadonlyArray<FuseResultMatch> | undefined
): HighlightRange[] => {
  const basenameOffset = item.length - path.basename(item).length;

  return (matches ?? []).flatMap(({ key, indices }) => {
    if (!indices || (key !== 'name' && key !== 'stem' && key !== 'path')) {
      return [];
    }
    const offset = key === 'name' || key === 'stem' ? basenameOffset : 0;
    return indices
      .map(([s, e]): HighlightRange => [s + offset, e + offset])
      .filter(([s, e]) => s >= 0 && e < item.length);
  });
};

const isStrongTokenHit = (
  item: string,
  token: string,
  score: number | undefined
): boolean => {
  const compactItem = normalizeSearchText(item);
  if (compactItem.includes(token)) return true;

  // Allow typo-tolerant fuzzy fallback, but keep it strict enough so
  // weak/non-intuitive hits do not count as full token coverage.
  return token.length >= 3 && (score ?? 1) <= 0.22;
};

const boundaryBonus = (item: string, token: string): number => {
  const lowerItem = item.toLowerCase();
  const idx = lowerItem.indexOf(token);
  if (idx < 0) return 0;

  const prev = idx > 0 ? item[idx - 1] : '';
  const atBoundary =
    idx === 0 ||
    prev === '/' ||
    prev === '\\' ||
    prev === '-' ||
    prev === '_' ||
    prev === '.';
  const camelBoundary =
    idx > 0 &&
    item[idx] === item[idx].toUpperCase() &&
    item[idx] !== item[idx].toLowerCase();

  if (atBoundary) return 0.08;
  if (camelBoundary) return 0.05;
  return 0;
};

const computeRank = (
  query: string,
  item: string,
  fuseScore: number,
  tokens: readonly string[],
  matchedTokenCount: number
): number => {
  const basename = path.basename(item);
  const stem = path.basename(item, path.extname(item));

  const lowerBasename = basename.toLowerCase();
  const lowerStem = stem.toLowerCase();
  const compactBasename = normalizeSearchText(basename);
  const compactStem = normalizeSearchText(stem);

  let rank = fuseScore;

  if (tokens.length > 0 && matchedTokenCount < tokens.length) {
    rank += (tokens.length - matchedTokenCount) * 0.3;
  }

  for (const token of tokens) {
    if (compactStem === token) rank -= 0.35;
    if (compactBasename === token) rank -= 0.2;

    if (compactStem.startsWith(token)) rank -= 0.14;
    if (compactBasename.startsWith(token)) rank -= 0.08;

    if (lowerStem.includes(token)) rank -= Math.min(0.14, token.length * 0.012);
    if (lowerBasename.includes(token))
      rank -= Math.min(0.1, token.length * 0.01);

    rank -= boundaryBonus(item, token);

    if (!compactStem.includes(token) && compactBasename.includes(token)) {
      rank += 0.06;
    }
  }

  const exactCaseHit = tokens.some(token => item.includes(token));
  if (exactCaseHit) rank -= 0.01;

  const compactQuery = normalizeSearchText(query.trim());
  if (compactQuery && compactStem === compactQuery) rank -= 0.1;

  return rank;
};

const sortResults = (
  a: { item: string; rank: number },
  b: { item: string; rank: number }
): number => {
  const rankDelta = a.rank - b.rank;
  if (Math.abs(rankDelta) > 1e-9) return rankDelta;

  const lengthDelta = a.item.length - b.item.length;
  if (lengthDelta !== 0) return lengthDelta;

  return a.item.localeCompare(b.item);
};

export const fuzzySearch = (query: string, items: string[]): FuzzyResult[] => {
  if (!query.trim()) {
    return items.map((item, refIndex) => ({ item, refIndex, highlights: [] }));
  }

  const fuse = new Fuse(items, FUSE_OPTIONS);
  const tokens = tokenizeQuery(query);

  const perItem = new Map<number, MatchTokenState>();

  for (const token of tokens) {
    const tokenResults = fuse.search(token);
    for (const entry of tokenResults) {
      if (!isStrongTokenHit(entry.item, token, entry.score)) continue;

      const state = perItem.get(entry.refIndex) ?? {
        scoreSum: 0,
        matchCount: 0,
        tokenHits: new Set<string>(),
        ranges: [],
      };

      if (!state.tokenHits.has(token)) {
        state.scoreSum += entry.score ?? 1;
        state.matchCount += 1;
        state.tokenHits.add(token);
      }

      state.ranges.push(...extractRanges(entry.item, entry.matches));
      perItem.set(entry.refIndex, state);
    }
  }

  const rows = items
    .map((item, refIndex) => {
      const state = perItem.get(refIndex);
      if (!state) return null;

      const avgScore =
        state.matchCount > 0 ? state.scoreSum / state.matchCount : 1;
      const rank = computeRank(
        query,
        item,
        avgScore,
        tokens,
        state.tokenHits.size
      );

      return {
        item,
        refIndex,
        rank,
        matchedAllTokens: state.tokenHits.size === tokens.length,
        highlights: mergeRanges(state.ranges),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const fullMatches = rows.filter(row => row.matchedAllTokens);
  const candidateRows = fullMatches.length > 0 ? fullMatches : rows;

  return candidateRows
    .sort(sortResults)
    .map(({ item, refIndex, highlights }) => ({ item, refIndex, highlights }));
};
