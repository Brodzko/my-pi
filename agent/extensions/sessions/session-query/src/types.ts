import type { Usage } from '@mariozechner/pi-ai';

export type QueryConfidence = 'high' | 'medium' | 'low';

export type QueryCitation = {
  entryId: string;
  role: 'user' | 'assistant';
  excerpt: string;
};

export type QuerySessionArgs = {
  session: string;
  question: string;
};

export type QuerySessionResult = {
  sessionId: string;
  sessionName: string;
  answerMarkdown: string;
  confidence: QueryConfidence;
  citations?: QueryCitation[];
  notes?: string[];
};

export type QueryUsage = Usage;

export type QuerySessionConfig = {
  enabled: boolean;
  statusKey: string;
  notificationAutoClearMs: number;
  modelKeys: string[];
  maxBytes: number;
  maxCallsPerTurn: number;
  timeoutMs: number;
  useSessionsMeta: boolean;
};

export type DiscoverySource = 'meta' | 'file';

export type DiscoveredSession = {
  sessionId: string;
  sessionFile: string;
  displayName: string;
  source: DiscoverySource;
};

export type ResolvedBy = 'id' | 'name-exact';

export type ResolvedSession = DiscoveredSession & {
  resolvedBy: ResolvedBy;
};

export type ResolveSessionNotFoundError = {
  code: 'SESSION_NOT_FOUND';
  session: string;
};

export type ResolveSessionAmbiguousError = {
  code: 'SESSION_AMBIGUOUS';
  session: string;
  candidates: DiscoveredSession[];
};

export type ResolveSessionError =
  | ResolveSessionNotFoundError
  | ResolveSessionAmbiguousError;

export type ResolveSessionResult =
  | {
      ok: true;
      value: ResolvedSession;
    }
  | {
      ok: false;
      error: ResolveSessionError;
    };

export type QueryTelemetryEntry = {
  success: boolean;
  timestamp: string;
  sourceSessionId?: string;
  sourceSessionName?: string;
  sessionId?: string;
  resolvedBy?: ResolvedBy;
  model?: string;
  question: string;
  questionChars: number;
  confidence?: QueryConfidence;
  usage?: QueryUsage;
  serializedBytes: number;
  truncated: boolean;
  latencyMs: number;
  error?: string;
  notes?: string[];
};
