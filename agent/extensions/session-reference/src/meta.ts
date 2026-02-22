import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const SessionMetaSchema = z.object({
  sessionId: z.string().min(1),
  sessionFile: z.string().min(1),
  parentSessionFile: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)),
  cwd: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  model: z.string().min(1),
  lastIndexedLeafId: z.string(),
});

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

export type SessionMetaReadResult = {
  meta: SessionMeta | undefined;
  warning: string | undefined;
};

const getMetaDir = () =>
  path.join(os.homedir(), '.pi', 'agent', 'sessions-meta');

export const getMetaFilePath = (sessionId: string) =>
  path.join(getMetaDir(), `${sessionId}.meta.json`);

const isEnoentError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';

export const readSessionMetaFile = async (
  sessionId: string
): Promise<SessionMetaReadResult> => {
  const filePath = getMetaFilePath(sessionId);

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isEnoentError(error)) {
      return {
        meta: undefined,
        warning: undefined,
      };
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      meta: undefined,
      warning: `Invalid JSON in meta file: ${filePath}`,
    };
  }

  const meta = SessionMetaSchema.safeParse(parsed);
  if (!meta.success) {
    return {
      meta: undefined,
      warning: `Invalid meta shape in ${filePath}`,
    };
  }

  return {
    meta: meta.data,
    warning: undefined,
  };
};
