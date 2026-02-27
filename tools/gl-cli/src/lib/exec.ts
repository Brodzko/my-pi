import { execFile } from 'node:child_process';
import { GlError, ErrorCode } from './errors.js';
import { log } from './envelope.js';

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const debug = process.env['GL_DEBUG'] === '1';

export const exec = (
  cmd: string,
  args: readonly string[]
): Promise<ExecResult> =>
  new Promise(resolve => {
    if (debug) {
      log(`[gl:exec] ${cmd} ${args.join(' ')}`);
    }
    execFile(
      cmd,
      args,
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const exitCode =
          err && 'code' in err ? (err.code as number) : err ? 1 : 0;
        if (debug) {
          if (stderr) log(`[gl:exec:stderr] ${stderr.slice(0, 500)}`);
        }
        resolve({ stdout, stderr, exitCode });
      }
    );
  });

export const execGlab = async (args: readonly string[]): Promise<string> => {
  const result = await exec('glab', args);
  if (result.exitCode !== 0) {
    // Check for auth issues
    if (
      result.stderr.includes('auth') ||
      result.stderr.includes('401') ||
      result.stderr.includes('token')
    ) {
      throw new GlError(
        ErrorCode.AUTH_REQUIRED,
        "GitLab authentication required. Run 'glab auth login' to authenticate."
      );
    }
    // Check for not found
    if (result.stderr.includes('404') || result.stderr.includes('not found')) {
      throw new GlError(
        ErrorCode.NOT_FOUND,
        result.stderr.trim() || 'Resource not found'
      );
    }
    throw new GlError(
      ErrorCode.GLAB_ERROR,
      `glab command failed: ${result.stderr.trim() || 'unknown error'}`,
      { args, exitCode: result.exitCode }
    );
  }
  return result.stdout;
};

export const execGlabJson = async <T>(
  args: readonly string[],
  parse: (data: unknown) => T
): Promise<T> => {
  const stdout = await execGlab(args);
  try {
    const raw = JSON.parse(stdout) as unknown;
    return parse(raw);
  } catch (err) {
    if (err instanceof GlError) throw err;
    throw new GlError(
      ErrorCode.UPSTREAM_ERROR,
      `Failed to parse glab JSON output: ${err instanceof Error ? err.message : String(err)}`,
      { stdout: stdout.slice(0, 500) }
    );
  }
};

export const execGit = async (args: readonly string[]): Promise<string> => {
  const result = await exec('git', args);
  if (result.exitCode !== 0) {
    throw new GlError(
      ErrorCode.LOCAL_GIT_ERROR,
      `Git command failed: ${result.stderr.trim() || 'unknown error'}`,
      { args, exitCode: result.exitCode }
    );
  }
  return result.stdout.trim();
};
