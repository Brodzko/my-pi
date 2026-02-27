import { GlError, ErrorCode } from './errors.js';
import { exec } from './exec.js';
import { log } from './envelope.js';

let authChecked = false;

/**
 * Verify glab authentication. Cached for the process lifetime.
 * Throws AUTH_REQUIRED if glab is not authenticated.
 */
export const ensureAuth = async (): Promise<void> => {
  if (authChecked) return;

  const result = await exec('glab', ['auth', 'status']);
  if (result.exitCode !== 0) {
    throw new GlError(
      ErrorCode.AUTH_REQUIRED,
      "GitLab authentication required. Run 'glab auth login' to authenticate.",
      { stderr: result.stderr.slice(0, 500) }
    );
  }

  if (process.env['GL_DEBUG'] === '1') {
    log('[gl:auth] Authenticated via glab');
  }

  authChecked = true;
};
