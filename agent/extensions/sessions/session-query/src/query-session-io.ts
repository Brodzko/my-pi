import type { FileEntry, SessionEntry } from '@mariozechner/pi-coding-agent';
import { toErrorMessage } from '../../shared/feedback';
import {
  QUERY_SESSION_ERROR_CODES,
  QuerySessionToolError,
} from './query-session-errors';

type QuerySessionIoDependencies = {
  parseSessionEntries: (content: string) => FileEntry[];
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
};

const isSessionEntry = (entry: FileEntry): entry is SessionEntry =>
  entry.type !== 'session';

const buildCurrentBranch = (entries: SessionEntry[]): SessionEntry[] => {
  if (entries.length === 0) {
    return [];
  }

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  const visited = new Set<string>();

  let cursor: SessionEntry | undefined = entries[entries.length - 1];

  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new QuerySessionToolError(
        QUERY_SESSION_ERROR_CODES.sessionParseFailed,
        'Session entry cycle detected while building branch context'
      );
    }

    visited.add(cursor.id);
    branch.push(cursor);

    if (!cursor.parentId) {
      break;
    }

    cursor = byId.get(cursor.parentId);
  }

  return branch.reverse();
};

const isEnoentError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';

export const loadSessionBranch = async (
  sessionFile: string,
  deps: QuerySessionIoDependencies
): Promise<SessionEntry[]> => {
  let content: string;

  try {
    content = await deps.readFile(sessionFile, 'utf8');
  } catch (error) {
    if (isEnoentError(error)) {
      throw new QuerySessionToolError(
        QUERY_SESSION_ERROR_CODES.sessionFileMissing,
        `Session file not found: ${sessionFile}`,
        {
          details: {
            sessionFile,
          },
        }
      );
    }

    throw error;
  }

  let fileEntries: FileEntry[];
  try {
    fileEntries = deps.parseSessionEntries(content);
  } catch (error) {
    const message = toErrorMessage(error, 'Unknown JSONL parse error');

    throw new QuerySessionToolError(
      QUERY_SESSION_ERROR_CODES.sessionParseFailed,
      `Failed to parse session file: ${sessionFile}`,
      {
        details: {
          sessionFile,
          reason: message,
        },
      }
    );
  }

  return buildCurrentBranch(fileEntries.filter(isSessionEntry));
};
