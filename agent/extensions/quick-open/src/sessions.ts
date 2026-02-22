import fs from 'fs/promises';
import path from 'path';
import * as R from 'remeda';
import { parseSessionFileLabel } from '../../shared/session-file-label';

export type SessionEntry = {
  id: string;
  file: string;
  label: string;
  ago: string;
  hasName: boolean;
};

type RichEntry = SessionEntry & { mtime: number };

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
        const parsed = parseSessionFileLabel(content, stem, {
          firstUserTextMaxChars: 60,
        });

        return {
          id: parsed.sessionId,
          file: filePath,
          label: parsed.displayName,
          ago: formatAgo(stat.mtime),
          hasName: parsed.hasName,
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
