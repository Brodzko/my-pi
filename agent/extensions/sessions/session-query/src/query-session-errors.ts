import type { QueryUsage } from './types';
import { QueryGenerateError } from './query-generate';

export const QUERY_SESSION_ERROR_CODES = {
  invalidArgs: 'INVALID_ARGS',
  callLimitExceeded: 'CALL_LIMIT_EXCEEDED',
  sessionNotFound: 'SESSION_NOT_FOUND',
  sessionAmbiguous: 'SESSION_AMBIGUOUS',
  sessionFileMissing: 'SESSION_FILE_MISSING',
  sessionParseFailed: 'SESSION_PARSE_FAILED',
  sessionEmpty: 'SESSION_EMPTY',
  queryModelUnavailable: 'QUERY_MODEL_UNAVAILABLE',
  queryTransportFailed: 'QUERY_TRANSPORT_FAILED',
  queryInvalidOutput: 'QUERY_INVALID_OUTPUT',
  unknown: 'UNKNOWN_QUERY_SESSION_ERROR',
} as const;

export type QuerySessionErrorCode =
  (typeof QUERY_SESSION_ERROR_CODES)[keyof typeof QUERY_SESSION_ERROR_CODES];

export class QuerySessionToolError extends Error {
  code: QuerySessionErrorCode;
  details?: Record<string, unknown>;
  usage?: QueryUsage;
  model?: string;

  constructor(
    code: QuerySessionErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      usage?: QueryUsage;
      model?: string;
    }
  ) {
    super(message);
    this.name = 'QuerySessionToolError';
    this.code = code;
    this.details = options?.details;
    this.usage = options?.usage;
    this.model = options?.model;
  }
}

export const mapGenerateError = (
  error: QueryGenerateError
): QuerySessionToolError => {
  if (error.kind === 'model_unavailable') {
    return new QuerySessionToolError(
      QUERY_SESSION_ERROR_CODES.queryModelUnavailable,
      error.message,
      {
        model: error.model,
      }
    );
  }

  if (error.kind === 'transport') {
    return new QuerySessionToolError(
      QUERY_SESSION_ERROR_CODES.queryTransportFailed,
      error.message,
      {
        model: error.model,
      }
    );
  }

  return new QuerySessionToolError(
    QUERY_SESSION_ERROR_CODES.queryInvalidOutput,
    error.message,
    {
      usage: error.usage,
      model: error.model,
    }
  );
};

export const toToolErrorMessage = (error: QuerySessionToolError): string =>
  JSON.stringify(
    {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    null,
    2
  );

export const toTelemetryErrorMessage = (error: unknown): string => {
  if (error instanceof QuerySessionToolError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown query_session error';
};

export const toStatusFailureMessage = (error: unknown): string => {
  if (error instanceof QuerySessionToolError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown error';
};
