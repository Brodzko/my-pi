import type { ResolvedSessionReference } from './resolve';

export type InjectionPayloadResult = {
  content: string;
  injectedBytes: number;
  truncated: boolean;
};

const TRUNCATED_NOTE = '\n\n[truncated to fit maxInjectedBytes]';

const truncateUtf8 = (content: string, maxBytes: number): string => {
  if (maxBytes <= 0) {
    return '';
  }

  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length <= maxBytes) {
    return content;
  }

  let truncated = bytes.subarray(0, maxBytes).toString('utf8');

  while (Buffer.byteLength(truncated, 'utf8') > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  return truncated;
};

const formatSessionSection = (
  resolved: ResolvedSessionReference,
  index: number
): string => {
  const tags =
    resolved.meta.tags.length > 0 ? resolved.meta.tags.join(', ') : '-';

  return [
    `## ${index + 1}. ${resolved.meta.name} (${resolved.sessionId})`,
    `updatedAt: ${resolved.meta.updatedAt}`,
    `description: ${resolved.meta.description}`,
    `summary: ${resolved.meta.summary}`,
    `tags: ${tags}`,
  ].join('\n');
};

export const buildInjectionPayload = (
  resolvedReferences: ResolvedSessionReference[],
  maxInjectedBytes: number
): InjectionPayloadResult => {
  const sections = resolvedReferences.map(formatSessionSection);
  const fullContent = ['Referenced session summaries:', ...sections].join(
    '\n\n'
  );

  const fullBytes = Buffer.byteLength(fullContent, 'utf8');
  if (fullBytes <= maxInjectedBytes) {
    return {
      content: fullContent,
      injectedBytes: fullBytes,
      truncated: false,
    };
  }

  const noteBytes = Buffer.byteLength(TRUNCATED_NOTE, 'utf8');
  const maxBodyBytes = Math.max(0, maxInjectedBytes - noteBytes);
  const truncatedBody = truncateUtf8(fullContent, maxBodyBytes);
  const truncatedContent = `${truncatedBody}${TRUNCATED_NOTE}`;

  return {
    content: truncatedContent,
    injectedBytes: Buffer.byteLength(truncatedContent, 'utf8'),
    truncated: true,
  };
};
