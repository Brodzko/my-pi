export type TextBlock = {
  type: 'text';
  text: string;
};

export const isTextBlock = (value: unknown): value is TextBlock => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.type === 'text' && typeof candidate.text === 'string';
};

export const getTextFromMessageContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter(isTextBlock)
    .map(block => block.text.trim())
    .filter(text => text.length > 0)
    .join('\n')
    .trim();
};

export const getFirstTextFromMessageContent = (
  content: unknown
): string | undefined => {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content) {
    if (!isTextBlock(block)) {
      continue;
    }

    const trimmed = block.text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
};
