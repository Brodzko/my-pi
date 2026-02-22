import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getMetaFilePath, isEnoentError } from './sessions-meta-path';

export { getMetaFilePath };

const SessionMetaSchema = z.object({
  schemaVersion: z.literal(1).default(1),
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

const SessionMetaOverlaySchema = SessionMetaSchema.pick({
  sessionId: true,
  sessionFile: true,
  name: true,
});

export type SessionMeta = z.infer<typeof SessionMetaSchema>;
export type SessionMetaOverlay = z.infer<typeof SessionMetaOverlaySchema>;

export type ReadMetaResult<TMeta> = {
  meta: TMeta | undefined;
  warning: string | undefined;
};

export type ReadSessionMetaResult = ReadMetaResult<SessionMeta>;
export type ReadSessionMetaOverlayResult = ReadMetaResult<SessionMetaOverlay>;

const parseMetaWithSchema = <TMeta>(
  content: string,
  filePath: string,
  schema: z.ZodType<TMeta>
): ReadMetaResult<TMeta> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      meta: undefined,
      warning: `Invalid JSON in meta file: ${filePath}`,
    };
  }

  const meta = schema.safeParse(parsed);
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

const readMetaFileByPath = async <TMeta>(
  filePath: string,
  schema: z.ZodType<TMeta>
): Promise<ReadMetaResult<TMeta>> => {
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

  return parseMetaWithSchema(content, filePath, schema);
};

export const readSessionMetaFile = async (
  sessionId: string
): Promise<ReadSessionMetaResult> => {
  const filePath = getMetaFilePath(sessionId);
  return readMetaFileByPath(filePath, SessionMetaSchema);
};

export const readSessionMetaOverlayFileByPath = async (
  filePath: string
): Promise<ReadSessionMetaOverlayResult> =>
  readMetaFileByPath(filePath, SessionMetaOverlaySchema);

export const writeSessionMetaFileAtomic = async (
  sessionId: string,
  meta: SessionMeta
): Promise<void> => {
  const filePath = getMetaFilePath(sessionId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
};
