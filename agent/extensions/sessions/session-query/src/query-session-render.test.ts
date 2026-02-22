import { describe, expect, it } from 'vitest';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import { initTheme } from '@mariozechner/pi-coding-agent';
import { createQuerySessionRenderers } from './query-session-render';
import type { QuerySessionResult } from './types';

const theme = {
  fg: (_tone: string, text: string) => text,
  bold: (text: string) => text,
};

initTheme();

const successResult: AgentToolResult<QuerySessionResult> = {
  content: [
    {
      type: 'text',
      text: '### Session: Test (`id`)\n\nAnswer body',
    },
  ],
  details: {
    sessionId: 'id',
    sessionName: 'Test',
    answerMarkdown: 'Answer body',
    confidence: 'high',
  },
};

describe('createQuerySessionRenderers', () => {
  it('does not crash on malformed call args and shows fallback question', () => {
    const renderers = createQuerySessionRenderers();

    const callComponent = renderers.renderCall(
      { session: 'abc-session' },
      theme as never
    );

    const lines = callComponent.render(120);
    expect(lines[0]).toContain('query_session');
    expect(lines[0]).toContain('abc-session');
    expect(lines[0]).toContain('(no question)');
  });

  it('supports JSON-string args with legacy `questions` key', () => {
    const renderers = createQuerySessionRenderers();

    const callComponent = renderers.renderCall(
      JSON.stringify({ session: 'abc-session', questions: 'what happened?' }),
      theme as never
    );

    const lines = callComponent.render(120);
    expect(lines[0]).toContain('abc-session');
    expect(lines[0]).toContain('what happened?');
  });

  it('hides answer when collapsed and shows it when expanded', () => {
    const renderers = createQuerySessionRenderers();
    renderers.renderCall(
      {
        session: 'abc-session',
        question: 'what happened?',
      },
      theme as never
    );

    const collapsed = renderers.renderResult(
      successResult,
      {
        expanded: false,
        isPartial: false,
      },
      theme as never
    );
    const collapsedLines = collapsed.render(120);
    expect(collapsedLines.length).toBe(1);

    const expanded = renderers.renderResult(
      successResult,
      {
        expanded: true,
        isPartial: false,
      },
      theme as never
    );
    const expandedLines = expanded.render(120);
    expect(expandedLines.join('\n')).toContain('Answer body');
  });
});
