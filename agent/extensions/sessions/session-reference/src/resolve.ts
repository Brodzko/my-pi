import {
  readSessionMetaFile,
  type SessionMeta,
} from '../../shared/session-meta';

export const SESSION_REFERENCE_ERROR_CODES = {
  notFound: 'not_found',
  invalidMeta: 'invalid_meta',
  overLimit: 'over_limit',
} as const;

export type SessionReferenceErrorCode =
  (typeof SESSION_REFERENCE_ERROR_CODES)[keyof typeof SESSION_REFERENCE_ERROR_CODES];

export type ResolvedSessionReference = {
  sessionId: string;
  meta: SessionMeta;
};

export type UnresolvedSessionReference = {
  sessionId: string;
  reason: SessionReferenceErrorCode;
};

export type ResolveSessionReferencesResult = {
  resolved: ResolvedSessionReference[];
  unresolved: UnresolvedSessionReference[];
};

export const resolveSessionReferences = async (
  sessionIds: string[]
): Promise<ResolveSessionReferencesResult> => {
  const resolved: ResolveSessionReferencesResult['resolved'] = [];
  const unresolved: ResolveSessionReferencesResult['unresolved'] = [];

  for (const sessionId of sessionIds) {
    const metaResult = await readSessionMetaFile(sessionId);

    if (metaResult.warning) {
      unresolved.push({
        sessionId,
        reason: SESSION_REFERENCE_ERROR_CODES.invalidMeta,
      });
      continue;
    }

    if (!metaResult.meta) {
      unresolved.push({
        sessionId,
        reason: SESSION_REFERENCE_ERROR_CODES.notFound,
      });
      continue;
    }

    resolved.push({
      sessionId,
      meta: metaResult.meta,
    });
  }

  return {
    resolved,
    unresolved,
  };
};
