import path from 'path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export type FetchMethod = 'git' | 'rg' | 'find' | 'none';

export type FileResult = {
  files: string[];
  method: FetchMethod;
  durationMs: number;
  fromCache: boolean;
};

type FetchResult = {
  files: string[];
  method: FetchMethod;
  durationMs: number;
};

type FileCache = {
  cwd: string;
  files: string[];
  fetchedAt: number;
  refreshing: boolean;
  method: FetchMethod;
  durationMs: number;
};

const CACHE_TTL_MS = 10_000;
const BACKGROUND_REFRESH_INTERVAL_MS = 2_000;

const IGNORED_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'target',
];

let cache: FileCache | null = null;

/**
 * Derive every unique parent directory from a list of file paths.
 * e.g. "a/b/c.ts" → ["a", "a/b"]
 */
const collectDirs = (files: string[]): string[] => {
  const dirs = new Set<string>();
  for (const f of files) {
    let dir = path.dirname(f);
    while (dir !== '.') {
      if (dirs.has(dir)) break;
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  return [...dirs].sort();
};

const parseFileList = (stdout: string, stripDotSlash = false): string[] => {
  const files = stdout
    .split('\n')
    .map(f => (stripDotSlash ? f.replace(/^\.\//, '').trim() : f.trim()))
    .filter(Boolean);
  return [...files, ...collectDirs(files)];
};

const fetchFiles = async (
  cwd: string,
  pi: ExtensionAPI
): Promise<FetchResult> => {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  // Prefer git ls-files. Note: --others walks untracked files, which can be
  // slow if large dirs aren't covered by .gitignore.
  const git = await pi.exec(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd, timeout: 10_000 }
  );
  if (git.code === 0) {
    return {
      files: parseFileList(git.stdout),
      method: 'git',
      durationMs: elapsed(),
    };
  }

  // Not a git repo — try ripgrep (multithreaded, respects ignore files).
  const rg = await pi.exec(
    'rg',
    [
      '--files',
      '--no-require-git',
      ...IGNORED_DIRS.flatMap(p => ['--glob', `!${p}`]),
    ],
    { cwd, timeout: 10_000 }
  );
  if (rg.code === 0) {
    return {
      files: parseFileList(rg.stdout),
      method: 'rg',
      durationMs: elapsed(),
    };
  }

  // Last resort: POSIX find.
  const find = await pi.exec(
    'find',
    [
      '.',
      '-type',
      'f',
      ...IGNORED_DIRS.flatMap(d => ['-not', '-path', `*/${d}/*`]),
    ],
    { cwd, timeout: 15_000 }
  );
  if (find.code === 0) {
    return {
      files: parseFileList(find.stdout, true),
      method: 'find',
      durationMs: elapsed(),
    };
  }

  return { files: [], method: 'none', durationMs: elapsed() };
};

const updateCache = (
  cwd: string,
  payload: FetchResult,
  refreshing: boolean
): void => {
  cache = {
    cwd,
    files: payload.files,
    fetchedAt: Date.now(),
    refreshing,
    method: payload.method,
    durationMs: payload.durationMs,
  };
};

const refreshCache = (cwd: string, pi: ExtensionAPI): Promise<void> =>
  fetchFiles(cwd, pi)
    .then(payload => {
      if (cache?.cwd !== cwd) return;
      updateCache(cwd, payload, false);
    })
    .catch(() => {
      if (cache?.cwd === cwd) cache.refreshing = false;
    });

/** Fire-and-forget cache warm-up — call on session_start / session_switch. */
export const prefetchFiles = (cwd: string, pi: ExtensionAPI): void => {
  if (cache?.cwd !== cwd) {
    cache = {
      cwd,
      files: [],
      fetchedAt: 0,
      refreshing: true,
      method: 'none',
      durationMs: 0,
    };
  }

  fetchFiles(cwd, pi)
    .then(payload => {
      if (cache?.cwd !== cwd) return;
      updateCache(cwd, payload, false);
    })
    .catch(() => {
      if (cache?.cwd === cwd) cache.refreshing = false;
      // Stale data is fine, we'll retry on the next dialog open.
    });
};

/**
 * Return files for `cwd`.
 * - Cache hit & fresh → return immediately (fromCache: true), with periodic background refresh.
 * - Cache hit & stale → await a fresh fetch (fromCache: false).
 * - Cache miss → await a fresh fetch (fromCache: false).
 */
export const getFiles = async (
  cwd: string,
  pi: ExtensionAPI
): Promise<FileResult> => {
  const now = Date.now();

  if (cache?.cwd === cwd) {
    const ageMs = now - cache.fetchedAt;
    const stale = ageMs > CACHE_TTL_MS;

    if (stale && !cache.refreshing) {
      cache.refreshing = true;
      const fresh = await fetchFiles(cwd, pi).catch(() => undefined);
      if (fresh) {
        updateCache(cwd, fresh, false);
        return {
          files: fresh.files,
          method: fresh.method,
          durationMs: fresh.durationMs,
          fromCache: false,
        };
      }
      if (cache?.cwd === cwd) cache.refreshing = false;
    } else if (ageMs > BACKGROUND_REFRESH_INTERVAL_MS && !cache.refreshing) {
      cache.refreshing = true;
      void refreshCache(cwd, pi);
    }

    return {
      files: cache.files,
      method: cache.method,
      durationMs: cache.durationMs,
      fromCache: true,
    };
  }

  const fresh = await fetchFiles(cwd, pi);
  updateCache(cwd, fresh, false);
  return {
    files: fresh.files,
    method: fresh.method,
    durationMs: fresh.durationMs,
    fromCache: false,
  };
};
