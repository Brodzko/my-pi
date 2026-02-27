export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  NOT_IN_GIT_REPO: 'NOT_IN_GIT_REPO',
  NO_GITLAB_REMOTE: 'NO_GITLAB_REMOTE',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  LINE_NOT_IN_DIFF: 'LINE_NOT_IN_DIFF',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  GLAB_ERROR: 'GLAB_ERROR',
  LOCAL_GIT_ERROR: 'LOCAL_GIT_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class GlError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GlError';
  }
}
