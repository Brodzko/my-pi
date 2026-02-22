import fs from 'fs/promises';
import path from 'path';
import * as R from 'remeda';

export type SessionEntry = {
  id: string;
  file: string;
  label: string;
  ago: string;
  hasName: boolean;
};

type RichEntry = SessionEntry & { mtime: number };

const SESSION_ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const extractSessionIdFromStem = (fileStem: string): string =>
  fileStem.match(SESSION_ID_PATTERN)?.[0] ?? fileStem;

const formatAgo = (mtime: Date): string => {
  const diffMs = Date.now() - mtime.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  return mtime.toLocaleDateString();
};

/**
 * Extract session metadata from NDJSON content.
 * Session id priority: explicit session.id > UUID-like part of filename stem > full stem.
 * Label priority: session_info.name > first user message text > filename stem.
 */
const extractSessionData = (
  content: string,
  fileStem: string
): { id: string; label: string; hasName: boolean } => {
  let sessionId: string | undefined;
  let sessionName: string | undefined;
  let firstUserText: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (
      !sessionId &&
      entry.type === 'session' &&
      typeof entry.id === 'string' &&
      entry.id
    ) {
      sessionId = entry.id;
    }

    if (
      entry.type === 'session_info' &&
      typeof entry.name === 'string' &&
      entry.name
    ) {
      sessionName = entry.name;
    }

    if (!firstUserText && entry.type === 'message') {
      const msg = entry.message as Record<string, unknown> | undefined;
      if (msg?.role === 'user') {
        if (typeof msg.content === 'string') {
          firstUserText = msg.content.slice(0, 60);
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content as unknown[]) {
            const p = part as Record<string, unknown>;
            if (p.type === 'text' && typeof p.text === 'string') {
              firstUserText = p.text.slice(0, 60);
              break;
            }
          }
        }
      }
    }

    // Short-circuit once we have everything we care about.
    if (sessionId && sessionName && firstUserText) break;
  }

  return {
    id: sessionId ?? extractSessionIdFromStem(fileStem),
    label: sessionName ?? firstUserText ?? fileStem,
    hasName: Boolean(sessionName),
  };
};

/**
 * List all sessions in `sessionDir`, sorted newest-first.
 * Excludes the currently active session file.
 */
export const getSessions = async (
  sessionDir: string,
  currentSessionFile: string | undefined
): Promise<SessionEntry[]> => {
  let filenames: string[];
  try {
    filenames = await fs.readdir(sessionDir);
  } catch {
    return [];
  }

  const currentBase = currentSessionFile
    ? path.basename(currentSessionFile)
    : undefined;

  const settled = await Promise.allSettled(
    filenames
      .filter(f => !f.startsWith('.') && f !== currentBase)
      .map(async (f): Promise<RichEntry> => {
        const filePath = path.join(sessionDir, f);
        const [stat, content] = await Promise.all([
          fs.stat(filePath),
          fs.readFile(filePath, 'utf-8'),
        ]);

        if (!stat.isFile()) throw new Error('not a file');

        const stem = path.basename(f, path.extname(f));
        const { id, label, hasName } = extractSessionData(content, stem);

        return {
          id,
          file: filePath,
          label,
          ago: formatAgo(stat.mtime),
          hasName,
          mtime: stat.mtime.getTime(),
        };
      })
  );

  return R.pipe(
    settled,
    R.filter(
      (r): r is PromiseFulfilledResult<RichEntry> => r.status === 'fulfilled'
    ),
    R.map(r => r.value),
    R.sortBy([(entry: RichEntry) => entry.mtime, 'desc']),
    R.map(({ id, file, label, ago, hasName }) => ({
      id,
      file,
      label,
      ago,
      hasName,
    }))
  );
};
