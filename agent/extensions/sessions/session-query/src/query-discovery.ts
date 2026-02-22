import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { parseSessionFileLabel } from '../../../shared/session-file-label';
import {
  readSessionMetaOverlayFileByPath,
  type SessionMetaOverlay,
} from '../../shared/session-meta';
import { getSessionsMetaDir } from '../../shared/sessions-meta-path';
import type { DiscoveredSession, QuerySessionConfig } from './types';

const readMetaBySessionId = async (
  sessionDir: string,
  enabled: boolean
): Promise<Map<string, SessionMetaOverlay>> => {
  if (!enabled) {
    return new Map();
  }

  const metaDir = getSessionsMetaDir();

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
        const metaResult = await readSessionMetaOverlayFileByPath(filePath);

        if (!metaResult.meta) {
          return undefined;
        }

        const metaSessionDir = path.resolve(
          path.dirname(metaResult.meta.sessionFile)
        );
        if (metaSessionDir !== normalizedSessionDir) {
          return undefined;
        }

        return metaResult.meta;
      })
  );

  const map = new Map<string, SessionMetaOverlay>();

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
