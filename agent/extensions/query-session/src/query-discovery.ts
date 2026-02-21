import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { DiscoveredSession, QuerySessionConfig } from './types';

const SESSION_ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractSessionIdFromStem = (fileStem: string): string | undefined => {
  const match = fileStem.match(SESSION_ID_PATTERN);
  return match?.[0];
};

const getTextFromMessageContent = (content: unknown): string | undefined => {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type !== 'text' || typeof block.text !== 'string') {
      continue;
    }

    const trimmed = block.text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
};

const parseSessionFileLabel = (
  content: string,
  fileStem: string
): {
  sessionId: string;
  displayName: string;
} => {
  let sessionId: string | undefined;
  let sessionName: string | undefined;
  let firstUserText: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      continue;
    }

    if (
      !sessionId &&
      parsed.type === 'session' &&
      typeof parsed.id === 'string'
    ) {
      sessionId = parsed.id;
    }

    if (
      parsed.type === 'session_info' &&
      typeof parsed.name === 'string' &&
      parsed.name.trim().length > 0
    ) {
      sessionName = parsed.name.trim();
    }

    if (!firstUserText && parsed.type === 'message') {
      const message = parsed.message;
      if (isRecord(message) && message.role === 'user') {
        const userText = getTextFromMessageContent(message.content);
        if (userText) {
          firstUserText = userText.slice(0, 120);
        }
      }
    }

    if (sessionId && sessionName) {
      break;
    }
  }

  const fallbackSessionId = extractSessionIdFromStem(fileStem) ?? fileStem;

  return {
    sessionId: sessionId ?? fallbackSessionId,
    displayName: sessionName ?? firstUserText ?? fileStem,
  };
};

type MetaEntry = {
  sessionId: string;
  sessionFile: string;
  name: string;
};

const isMetaEntry = (value: unknown): value is MetaEntry => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    typeof value.sessionFile === 'string' &&
    value.sessionFile.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0
  );
};

const getMetaDir = (): string =>
  path.join(os.homedir(), '.pi', 'agent', 'sessions-meta');

const readMetaBySessionId = async (
  sessionDir: string,
  enabled: boolean
): Promise<Map<string, MetaEntry>> => {
  if (!enabled) {
    return new Map();
  }

  const metaDir = getMetaDir();

  let filenames: string[];
  try {
    filenames = await fs.readdir(metaDir);
  } catch {
    return new Map();
  }

  const normalizedSessionDir = path.resolve(sessionDir);

  const settled = await Promise.allSettled(
    filenames
      .filter(filename => filename.endsWith('.meta.json'))
      .map(async filename => {
        const filePath = path.join(metaDir, filename);
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content) as unknown;

        if (!isMetaEntry(parsed)) {
          return undefined;
        }

        const metaSessionDir = path.resolve(path.dirname(parsed.sessionFile));
        if (metaSessionDir !== normalizedSessionDir) {
          return undefined;
        }

        return parsed;
      })
  );

  const map = new Map<string, MetaEntry>();

  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value) {
      continue;
    }

    map.set(result.value.sessionId, result.value);
  }

  return map;
};

export const discoverSessions = async (
  ctx: ExtensionContext,
  config: QuerySessionConfig
): Promise<DiscoveredSession[]> => {
  const sessionDir = ctx.sessionManager.getSessionDir();

  let filenames: string[];
  try {
    filenames = await fs.readdir(sessionDir);
  } catch {
    return [];
  }

  const settled = await Promise.allSettled(
    filenames
      .filter(
        filename => !filename.startsWith('.') && filename.endsWith('.jsonl')
      )
      .map(async filename => {
        const sessionFile = path.join(sessionDir, filename);
        const stat = await fs.stat(sessionFile);

        if (!stat.isFile()) {
          return undefined;
        }

        const fileStem = path.basename(filename, path.extname(filename));
        const content = await fs.readFile(sessionFile, 'utf8');
        const parsed = parseSessionFileLabel(content, fileStem);

        return {
          sessionId: parsed.sessionId,
          sessionFile,
          displayName: parsed.displayName,
          source: 'file' as const,
        };
      })
  );

  const sessionsById = new Map<string, DiscoveredSession>();

  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value) {
      continue;
    }

    sessionsById.set(result.value.sessionId, result.value);
  }

  const metaBySessionId = await readMetaBySessionId(
    sessionDir,
    config.useSessionsMeta
  );

  return [...sessionsById.values()].map(session => {
    const meta = metaBySessionId.get(session.sessionId);
    if (!meta) {
      return session;
    }

    return {
      ...session,
      displayName: meta.name,
      sessionFile: meta.sessionFile,
      source: 'meta' as const,
    };
  });
};
