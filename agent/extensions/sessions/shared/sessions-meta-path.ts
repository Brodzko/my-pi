import os from 'node:os';
import path from 'node:path';

export const getSessionsMetaDir = () =>
  path.join(os.homedir(), '.pi', 'agent', 'sessions-meta');

export const getMetaFilePath = (sessionId: string) =>
  path.join(getSessionsMetaDir(), `${sessionId}.meta.json`);

export const isEnoentError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';
