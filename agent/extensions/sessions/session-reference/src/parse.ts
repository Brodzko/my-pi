export type ParsedSessionReferences = {
  references: string[];
  overLimitCount: number;
};

const SESSION_UUID_PATTERN =
  /@@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

export const parseSessionReferences = (
  prompt: string,
  maxRefsPerPrompt: number
): ParsedSessionReferences => {
  const references: string[] = [];
  const seen = new Set<string>();

  for (const match of prompt.matchAll(SESSION_UUID_PATTERN)) {
    const sessionId = match[1]?.toLowerCase();
    if (!sessionId || seen.has(sessionId)) {
      continue;
    }

    references.push(sessionId);
    seen.add(sessionId);
  }

  if (references.length <= maxRefsPerPrompt) {
    return {
      references,
      overLimitCount: 0,
    };
  }

  return {
    references: references.slice(0, maxRefsPerPrompt),
    overLimitCount: references.length - maxRefsPerPrompt,
  };
};
