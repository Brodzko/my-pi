import type { ResolvedSession } from './types';

export const collectRelatedSessions = async (
  resolvedSession: ResolvedSession
): Promise<ResolvedSession[]> => [resolvedSession];
