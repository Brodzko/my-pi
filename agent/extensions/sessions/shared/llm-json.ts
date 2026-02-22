import { isTextBlock } from '../../shared/message-content';

export const getResponseText = (responseContent: unknown): string => {
  if (!Array.isArray(responseContent)) {
    return '';
  }

  return responseContent
    .filter(isTextBlock)
    .map(content => content.text)
    .join('')
    .trim();
};

const stripMarkdownCodeFence = (text: string): string => {
  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!fencedMatch) {
    return text;
  }

  return fencedMatch[1]?.trim() ?? text;
};

export const extractLikelyJsonObject = (text: string): string => {
  const withoutFence = stripMarkdownCodeFence(text).trim();
  if (!withoutFence) {
    return withoutFence;
  }

  if (withoutFence.startsWith('{') && withoutFence.endsWith('}')) {
    return withoutFence;
  }

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return withoutFence;
  }

  return withoutFence.slice(firstBrace, lastBrace + 1).trim();
};
