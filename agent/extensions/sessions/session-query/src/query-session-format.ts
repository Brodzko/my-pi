import type { QuerySessionResult } from './types';

export const formatToolContent = (result: QuerySessionResult): string => {
  const lines = [
    `### Session: ${result.sessionName} (\`${result.sessionId}\`)`,
    `Confidence: **${result.confidence}**`,
    '',
    result.answerMarkdown,
  ];

  if (result.notes && result.notes.length > 0) {
    lines.push('', 'Notes:', ...result.notes.map(note => `- ${note}`));
  }

  return lines.join('\n');
};
