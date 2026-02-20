import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(res => {
    resolve = res;
  });

  if (!resolve) {
    throw new Error('Deferred resolver was not initialized');
  }

  return { promise, resolve };
};

type ExecMock = ReturnType<typeof vi.fn>;

const createPi = (exec: ExecMock): ExtensionAPI =>
  ({ exec }) as unknown as ExtensionAPI;

const gitOk = (stdout: string): ExecResult => ({
  code: 0,
  stdout,
  stderr: '',
});

describe('file cache behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T12:00:00.000Z'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached files for fresh cache entries', async () => {
    const exec = vi.fn(async () => gitOk('src/a.ts\n'));
    const pi = createPi(exec);
    const { getFiles } = await import('./files');

    const first = await getFiles('/cwd', pi);
    const second = await getFiles('/cwd', pi);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.files).toContain('src/a.ts');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('awaits a refresh when cache is stale', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(gitOk('src/a.ts\n'))
      .mockResolvedValueOnce(gitOk('src/a.ts\nsrc/new.ts\n'));
    const pi = createPi(exec);
    const { getFiles } = await import('./files');

    await getFiles('/cwd', pi);

    vi.setSystemTime(new Date('2026-02-20T12:00:11.000Z'));
    const refreshed = await getFiles('/cwd', pi);

    expect(refreshed.fromCache).toBe(false);
    expect(refreshed.files).toContain('src/new.ts');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('does not let background refresh from previous cwd overwrite current cache', async () => {
    const deferredRefresh = createDeferred<ExecResult>();
    let cwd1Calls = 0;

    const exec = vi.fn(
      async (
        _cmd: string,
        _args: string[],
        options: { cwd: string }
      ): Promise<ExecResult> => {
        if (options.cwd === '/cwd-1') {
          cwd1Calls += 1;
          if (cwd1Calls === 1) return gitOk('src/a.ts\n');
          return deferredRefresh.promise;
        }

        if (options.cwd === '/cwd-2') return gitOk('src/b.ts\n');

        return { code: 1, stdout: '', stderr: 'unexpected cwd' };
      }
    );

    const pi = createPi(exec);
    const { getFiles, prefetchFiles } = await import('./files');

    await getFiles('/cwd-1', pi);
    vi.setSystemTime(new Date('2026-02-20T12:00:03.000Z'));

    const warm = await getFiles('/cwd-1', pi);
    expect(warm.fromCache).toBe(true);

    prefetchFiles('/cwd-2', pi);
    await Promise.resolve();

    deferredRefresh.resolve(gitOk('src/should-not-overwrite.ts\n'));
    await deferredRefresh.promise;
    await Promise.resolve();

    const cwd2 = await getFiles('/cwd-2', pi);
    expect(cwd2.files).toContain('src/b.ts');
    expect(cwd2.files).not.toContain('src/should-not-overwrite.ts');
  });
});
