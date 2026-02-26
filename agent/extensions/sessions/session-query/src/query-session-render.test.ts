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

  it('shows confidence summary when collapsed', () => {
    const renderers = createQuerySessionRenderers();

    const collapsed = renderers.renderResult(
      successResult,
      { expanded: false, isPartial: false },
      theme as never
    );
    const collapsedOutput = collapsed.render(120).join('\n');

    expect(collapsedOutput).toContain('confidence: high');
    expect(collapsedOutput).not.toContain('Answer body');
  });

  it('shows full answer text when expanded', () => {
    const renderers = createQuerySessionRenderers();

    const expanded = renderers.renderResult(
      successResult,
      { expanded: true, isPartial: false },
      theme as never
    );
    const expandedOutput = expanded.render(120).join('\n');

    expect(expandedOutput).toContain('confidence: high');
    expect(expandedOutput).toContain('Answer body');
  });

  it('returns empty component while partial', () => {
    const renderers = createQuerySessionRenderers();

    const partial = renderers.renderResult(
      successResult,
      { expanded: false, isPartial: true },
      theme as never
    );
    const lines = partial.render(120);

    expect(lines).toHaveLength(0);
  });
});
