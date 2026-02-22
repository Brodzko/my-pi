import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMetaFilePath,
  readSessionMetaFile as readMetaFile,
  type SessionMeta as MetaFile,
  writeSessionMetaFileAtomic as writeMetaFileAtomic,
} from './session-meta';

let tempHomeDir = '';

beforeEach(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-meta-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
});

afterEach(async () => {
  vi.restoreAllMocks();

  if (tempHomeDir) {
    await fs.rm(tempHomeDir, { recursive: true, force: true });
  }
});

describe('readSessionMetaFile', () => {
  it('returns undefined when meta file does not exist', async () => {
    const result = await readMetaFile('missing-session');

    expect(result).toEqual({
      meta: undefined,
      warning: undefined,
    });
  });

  it('returns warning for invalid json', async () => {
    const filePath = getMetaFilePath('invalid-json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{ bad-json', 'utf8');

    const result = await readMetaFile('invalid-json');

    expect(result.meta).toBeUndefined();
    expect(result.warning).toContain('Invalid JSON in meta file');
  });

  it('returns warning for invalid meta shape', async () => {
    const filePath = getMetaFilePath('invalid-shape');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ sessionId: 'x' }), 'utf8');

    const result = await readMetaFile('invalid-shape');

    expect(result.meta).toBeUndefined();
    expect(result.warning).toContain('Invalid meta shape');
  });
});

describe('writeSessionMetaFileAtomic', () => {
  it('writes and can read valid meta file', async () => {
    const meta: MetaFile = {
      schemaVersion: 1,
      sessionId: 'session-1',
      sessionFile: '/tmp/session-1.jsonl',
      parentSessionFile: undefined,
      name: 'Session name',
      description: 'Description',
      summary: 'Summary',
      tags: ['a', 'b', 'c'],
      cwd: '/tmp',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      model: 'google-gemini-cli/gemini-2.5-flash',
      lastIndexedLeafId: 'leaf-1',
    };

    await writeMetaFileAtomic(meta.sessionId, meta);

    const result = await readMetaFile(meta.sessionId);
    expect(result).toEqual({
      meta,
      warning: undefined,
    });
  });
});
