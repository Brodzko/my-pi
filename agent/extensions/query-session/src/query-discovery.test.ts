import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { discoverSessions } from './query-discovery';
import type { QuerySessionConfig } from './types';

let tempDir = '';
let tempSessionDir = '';
let tempHomeDir = '';

const createCtx = (sessionDir: string): ExtensionContext =>
  ({
    sessionManager: {
      getSessionDir: () => sessionDir,
    },
  }) as unknown as ExtensionContext;

const createConfig = (
  overrides: Partial<QuerySessionConfig>
): QuerySessionConfig => ({
  enabled: true,
  statusKey: 'query-session',
  notificationAutoClearMs: 3000,
  modelKeys: ['google/gemini-2.5-flash'],
  maxBytes: 160_000,
  maxCallsPerTurn: 1,
  timeoutMs: 15_000,
  useSessionsMeta: true,
  ...overrides,
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'query-discovery-'));
  tempSessionDir = path.join(tempDir, 'sessions');
  tempHomeDir = path.join(tempDir, 'home');

  await fs.mkdir(tempSessionDir, { recursive: true });
  await fs.mkdir(tempHomeDir, { recursive: true });

  vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('discoverSessions', () => {
  it('discovers sessions from files when sessions-meta is unavailable', async () => {
    const sessionFile = path.join(
      tempSessionDir,
      '2026-02-20_demo_11111111-1111-4111-8111-111111111111.jsonl'
    );

    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: 'session',
          id: '11111111-1111-4111-8111-111111111111',
        }),
        JSON.stringify({
          type: 'message',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'First user prompt' }],
          },
        }),
      ].join('\n'),
      'utf8'
    );

    const sessions = await discoverSessions(
      createCtx(tempSessionDir),
      createConfig({ useSessionsMeta: false })
    );

    expect(sessions).toEqual([
      {
        sessionId: '11111111-1111-4111-8111-111111111111',
        sessionFile,
        displayName: 'First user prompt',
        source: 'file',
      },
    ]);
  });

  it('prefers metadata labels when sessions-meta is available', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const sessionFile = path.join(
      tempSessionDir,
      `2026-02-20_demo_${sessionId}.jsonl`
    );

    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: 'session', id: sessionId }),
        JSON.stringify({
          type: 'session_info',
          name: 'Label from session file',
        }),
      ].join('\n'),
      'utf8'
    );

    const metaDir = path.join(tempHomeDir, '.pi', 'agent', 'sessions-meta');
    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(
      path.join(metaDir, `${sessionId}.meta.json`),
      JSON.stringify({
        sessionId,
        sessionFile,
        name: 'Label from sessions-meta',
      }),
      'utf8'
    );

    const sessions = await discoverSessions(
      createCtx(tempSessionDir),
      createConfig({ useSessionsMeta: true })
    );

    expect(sessions).toEqual([
      {
        sessionId,
        sessionFile,
        displayName: 'Label from sessions-meta',
        source: 'meta',
      },
    ]);
  });
});
