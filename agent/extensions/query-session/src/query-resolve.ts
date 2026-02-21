import type {
  DiscoveredSession,
  ResolveSessionResult,
  ResolvedSession,
} from './types';

const normalize = (value: string): string => value.trim().toLowerCase();

const isUuidLike = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim()
  );

const withResolvedBy = (
  session: DiscoveredSession,
  resolvedBy: ResolvedSession['resolvedBy']
): ResolvedSession => ({
  ...session,
  resolvedBy,
});

export const resolveSessionReference = (
  sessions: DiscoveredSession[],
  reference: string
): ResolveSessionResult => {
  const normalizedReference = normalize(reference);

  if (isUuidLike(reference)) {
    const byId = sessions.find(
      session => normalize(session.sessionId) === normalizedReference
    );

    if (byId) {
      return {
        ok: true,
        value: withResolvedBy(byId, 'id'),
      };
    }
  }

  const byExactName = sessions.filter(
    session => normalize(session.displayName) === normalizedReference
  );

  if (byExactName.length === 1) {
    return {
      ok: true,
      value: withResolvedBy(byExactName[0], 'name-exact'),
    };
  }

  if (byExactName.length > 1) {
    return {
      ok: false,
      error: {
        code: 'SESSION_AMBIGUOUS',
        session: reference,
        candidates: byExactName,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'SESSION_NOT_FOUND',
      session: reference,
    },
  };
};
