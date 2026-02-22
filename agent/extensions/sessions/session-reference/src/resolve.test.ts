import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMetaFilePath } from '../../shared/session-meta';
import { resolveSessionReferences } from './resolve';
import { SESSION_REFERENCE_ERROR_CODES } from './resolve';

let tempHomeDir = '';

beforeEach(async () => {
  tempHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-reference-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
});

afterEach(async () => {
  vi.restoreAllMocks();

  if (tempHomeDir) {
    await fs.rm(tempHomeDir, { recursive: true, force: true });
  }
});

const writeMeta = async (sessionId: string) => {
  const filePath = getMetaFilePath(sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        sessionId,
        sessionFile: `/tmp/${sessionId}.jsonl`,
        name: 'Session',
        description: 'Description',
        summary: 'Summary',
        tags: ['a'],
        cwd: '/tmp',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        model: 'openai-codex/gpt-5.1-codex-mini',
        lastIndexedLeafId: 'leaf-1',
      },
      null,
      2
    ),
    'utf8'
  );
};

describe('resolveSessionReferences', () => {
  it('returns resolved metadata when file exists', async () => {
    const sessionId = '11111111-1111-1111-1111-111111111111';
    await writeMeta(sessionId);

    const result = await resolveSessionReferences([sessionId]);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.sessionId).toBe(sessionId);
    expect(result.unresolved).toEqual([]);
  });

  it('returns not_found for missing metadata', async () => {
    const result = await resolveSessionReferences([
      '22222222-2222-2222-2222-222222222222',
    ]);

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        sessionId: '22222222-2222-2222-2222-222222222222',
        reason: SESSION_REFERENCE_ERROR_CODES.notFound,
      },
    ]);
  });

  it('returns invalid_meta for malformed metadata', async () => {
    const sessionId = '33333333-3333-3333-3333-333333333333';
    const filePath = getMetaFilePath(sessionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{broken-json', 'utf8');

    const result = await resolveSessionReferences([sessionId]);

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([
      {
        sessionId,
        reason: SESSION_REFERENCE_ERROR_CODES.invalidMeta,
      },
    ]);
  });
});
