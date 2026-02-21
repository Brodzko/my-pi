import type {
  QueryConfidence,
  QueryTelemetryEntry,
  QueryUsage,
  ResolvedBy,
} from './types';

type CreateQueryTelemetryParams = {
  success: boolean;
  timestamp: string;
  sourceSessionId?: string;
  sourceSessionName?: string;
  resolvedBy?: ResolvedBy;
  model?: string;
  question: string;
  confidence?: QueryConfidence;
  usage?: QueryUsage;
  serializedBytes: number;
  truncated: boolean;
  latencyMs: number;
  error?: string;
  notes?: string[];
};

export const createQueryTelemetryEntry = (
  params: CreateQueryTelemetryParams
): QueryTelemetryEntry => ({
  success: params.success,
  timestamp: params.timestamp,
  sourceSessionId: params.sourceSessionId,
  sourceSessionName: params.sourceSessionName,
  sessionId: params.sourceSessionId,
  resolvedBy: params.resolvedBy,
  model: params.model,
  question: params.question,
  questionChars: params.question.length,
  confidence: params.confidence,
  usage: params.usage,
  serializedBytes: params.serializedBytes,
  truncated: params.truncated,
  latencyMs: params.latencyMs,
  error: params.error,
  notes: params.notes,
});
