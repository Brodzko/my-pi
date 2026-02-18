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

const CACHE_TTL_MS = 30_000;

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

/** Fire-and-forget cache warm-up — call on session_start / session_switch. */
export const prefetchFiles = (cwd: string, pi: ExtensionAPI): void => {
  fetchFiles(cwd, pi)
    .then(({ files, method, durationMs }) => {
      cache = {
        cwd,
        files,
        fetchedAt: Date.now(),
        refreshing: false,
        method,
        durationMs,
      };
    })
    .catch(() => {
      // Stale data is fine, we'll retry on the next dialog open.
    });
};

/**
 * Return files for `cwd`.
 * - Cache hit & fresh → return immediately (fromCache: true).
 * - Cache hit & stale → return stale + kick off background refresh.
 * - Cache miss → await a fresh fetch (fromCache: false).
 */
export const getFiles = async (
  cwd: string,
  pi: ExtensionAPI
): Promise<FileResult> => {
  const now = Date.now();

  if (cache?.cwd === cwd) {
    const stale = now - cache.fetchedAt > CACHE_TTL_MS;
    if (stale && !cache.refreshing) {
      cache.refreshing = true;
      fetchFiles(cwd, pi)
        .then(({ files, method, durationMs }) => {
          if (cache) {
            cache.files = files;
            cache.method = method;
            cache.durationMs = durationMs;
            cache.fetchedAt = Date.now();
            cache.refreshing = false;
          }
        })
        .catch(() => {
          if (cache) cache.refreshing = false;
        });
    }
    return {
      files: cache.files,
      method: cache.method,
      durationMs: cache.durationMs,
      fromCache: true,
    };
  }

  const { files, method, durationMs } = await fetchFiles(cwd, pi);
  cache = { cwd, files, fetchedAt: now, refreshing: false, method, durationMs };
  return { files, method, durationMs, fromCache: false };
};
