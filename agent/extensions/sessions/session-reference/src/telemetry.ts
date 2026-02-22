import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  SESSION_REFERENCE_ERROR_CODES,
  type SessionReferenceErrorCode,
} from './resolve';

export type SessionReferenceTelemetryEntry = {
  success: boolean;
  resolvedCount: number;
  unresolvedCount: number;
  unresolvedReasons: Record<SessionReferenceErrorCode, number>;
  injectedBytes: number;
  truncated: boolean;
  timestamp: string;
};

export const SESSION_REFERENCE_TELEMETRY_TYPE = 'session-reference:inject';

const SESSION_REFERENCE_ERROR_REASON_KEYS: SessionReferenceErrorCode[] = [
  SESSION_REFERENCE_ERROR_CODES.notFound,
  SESSION_REFERENCE_ERROR_CODES.invalidMeta,
  SESSION_REFERENCE_ERROR_CODES.overLimit,
];

const createReasonCounters = (): Record<SessionReferenceErrorCode, number> => ({
  [SESSION_REFERENCE_ERROR_CODES.notFound]: 0,
  [SESSION_REFERENCE_ERROR_CODES.invalidMeta]: 0,
  [SESSION_REFERENCE_ERROR_CODES.overLimit]: 0,
});

export const appendInjectionTelemetry = (
  pi: ExtensionAPI,
  entry: Omit<SessionReferenceTelemetryEntry, 'timestamp'>
) => {
  const telemetryEntry: SessionReferenceTelemetryEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  pi.appendEntry(SESSION_REFERENCE_TELEMETRY_TYPE, telemetryEntry);
};

export const countUnresolvedReasons = (
  reasons: SessionReferenceErrorCode[]
): Record<SessionReferenceErrorCode, number> => {
  const counters = createReasonCounters();

  for (const reason of reasons) {
    if (!SESSION_REFERENCE_ERROR_REASON_KEYS.includes(reason)) {
      continue;
    }

    counters[reason] += 1;
  }

  return counters;
};
