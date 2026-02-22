import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getExtensionDir } from '../../shared/config-loader';

export type DebugLogger = {
  log: (sessionId: string, message: string) => Promise<void>;
};

const extensionDir = getExtensionDir(import.meta.url);

export const createDebugLogger = (): DebugLogger => {
  const logPath = path.join(extensionDir, 'session-index.log');

  const log = async (sessionId: string, message: string): Promise<void> => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${sessionId}] ${message}\n`;

    try {
      await fs.appendFile(logPath, line, 'utf8');
    } catch {
      // Swallow logging errors, never break indexing flow.
    }
  };

  return {
    log,
  };
};

export const serializeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};
