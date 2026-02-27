import { GlError } from './errors.js';

export type SuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export const success = <T>(
  data: T,
  meta?: Record<string, unknown>
): SuccessEnvelope<T> => ({
  ok: true,
  data,
  ...(meta ? { meta } : {}),
});

export const error = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorEnvelope => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

export const outputJson = (envelope: Envelope<unknown>): void => {
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
};

export const outputError = (err: unknown): void => {
  if (err instanceof GlError) {
    outputJson(error(err.code, err.message, err.details));
    process.exitCode = 1;
    return;
  }
  if (err instanceof Error) {
    outputJson(error('UNKNOWN', err.message));
    process.exitCode = 1;
    return;
  }
  outputJson(error('UNKNOWN', String(err)));
  process.exitCode = 1;
};

/** Log to stderr (never stdout). */
export const log = (...args: unknown[]): void => {
  console.error(...args);
};
