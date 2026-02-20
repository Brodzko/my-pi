import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessions } from './sessions';

const writeSessionFile = async (
  dir: string,
  filename: string,
  content: string,
  mtime: Date
): Promise<string> => {
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  await fs.utimes(filePath, mtime, mtime);
  return filePath;
};

describe('getSessions', () => {
  let sessionDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T12:00:00.000Z'));
    sessionDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-open-sessions-')
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  it('sorts by newest first, excludes current session, and preserves name metadata', async () => {
    const now = new Date('2026-02-20T12:00:00.000Z');
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const currentSessionPath = await writeSessionFile(
      sessionDir,
      'current.ndjson',
      '{"type":"session_info","name":"Current"}\n',
      now
    );

    await writeSessionFile(
      sessionDir,
      'named.ndjson',
      '{"type":"session_info","name":"Planning"}\n{"type":"message","message":{"role":"user","content":"fallback text"}}\n',
      oneHourAgo
    );

    await writeSessionFile(
      sessionDir,
      'message.ndjson',
      '{"type":"message","message":{"role":"user","content":"first user prompt"}}\n',
      twoHoursAgo
    );

    await writeSessionFile(
      sessionDir,
      'fallback.ndjson',
      'not json\n',
      oneDayAgo
    );

    const sessions = await getSessions(sessionDir, currentSessionPath);

    expect(sessions.map(session => path.basename(session.file))).toEqual([
      'named.ndjson',
      'message.ndjson',
      'fallback.ndjson',
    ]);

    expect(sessions[0]).toMatchObject({
      label: 'Planning',
      hasName: true,
      ago: '1h',
    });

    expect(sessions[1]).toMatchObject({
      label: 'first user prompt',
      hasName: false,
      ago: '2h',
    });

    expect(sessions[2]).toMatchObject({
      label: 'fallback',
      hasName: false,
      ago: '1d',
    });
  });
});
