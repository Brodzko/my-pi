import { promises as fs } from 'node:fs';
import path from 'node:path';

export type DebugLogger = {
  log: (sessionId: string, message: string) => Promise<void>;
};

const LOG_DIR = '.brodzko/logs';
const LOG_FILE = 'session-handoff.log';

export const createDebugLogger = (cwd: string): DebugLogger => {
  const logPath = path.join(cwd, LOG_DIR, LOG_FILE);

  const log = async (sessionId: string, message: string): Promise<void> => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${sessionId}] ${message}\n`;

    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, line, 'utf8');
    } catch {
      // Swallow logging errors, never break handoff flow.
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
