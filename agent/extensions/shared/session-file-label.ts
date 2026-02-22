import { getFirstTextFromMessageContent } from './message-content';

const SESSION_ID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractSessionIdFromStem = (fileStem: string): string =>
  fileStem.match(SESSION_ID_PATTERN)?.[0] ?? fileStem;

export type ParsedSessionFileLabel = {
  sessionId: string;
  displayName: string;
  hasName: boolean;
};

export const parseSessionFileLabel = (
  content: string,
  fileStem: string,
  options?: {
    firstUserTextMaxChars?: number;
  }
): ParsedSessionFileLabel => {
  const firstUserTextMaxChars = options?.firstUserTextMaxChars ?? 120;

  let sessionId: string | undefined;
  let sessionName: string | undefined;
  let firstUserText: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      continue;
    }

    if (
      !sessionId &&
      parsed.type === 'session' &&
      typeof parsed.id === 'string' &&
      parsed.id.length > 0
    ) {
      sessionId = parsed.id;
    }

    if (
      parsed.type === 'session_info' &&
      typeof parsed.name === 'string' &&
      parsed.name.trim().length > 0
    ) {
      sessionName = parsed.name.trim();
    }

    if (!firstUserText && parsed.type === 'message') {
      const message = parsed.message;
      if (isRecord(message) && message.role === 'user') {
        const userText = getFirstTextFromMessageContent(message.content);
        if (userText) {
          firstUserText = userText.slice(0, firstUserTextMaxChars);
        }
      }
    }

    if (sessionId && sessionName) {
      break;
    }
  }

  return {
    sessionId: sessionId ?? extractSessionIdFromStem(fileStem),
    displayName: sessionName ?? firstUserText ?? fileStem,
    hasName: sessionName !== undefined,
  };
};
