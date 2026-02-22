import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@mariozechner/pi-ai';
import {
  createQuerySessionExecutor,
  type QuerySessionCallCounter,
} from './query-session-executor';
import { formatToolContent } from './query-session-format';
import { createQuerySessionRenderers } from './query-session-render';
import type { QuerySessionConfig } from './types';

const QUERY_SESSION_TOOL_NAME = 'query_session';

export const registerQuerySessionTool = (
  pi: ExtensionAPI,
  config: QuerySessionConfig,
  callCounter: QuerySessionCallCounter
) => {
  const executeQuerySession = createQuerySessionExecutor(
    pi,
    config,
    callCounter
  );
  const renderers = createQuerySessionRenderers();

  pi.registerTool({
    name: QUERY_SESSION_TOOL_NAME,
    label: 'Query session',
    description:
      'Query a previous session by id or exact name and answer a focused question using only that session context.',
    parameters: Type.Object(
      {
        session: Type.String({ minLength: 1 }),
        question: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false }
    ),
    renderCall: renderers.renderCall,
    renderResult: renderers.renderResult,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const result = await executeQuerySession(params, ctx);

      return {
        content: [
          {
            type: 'text',
            text: formatToolContent(result),
          },
        ],
        details: result,
      };
    },
  });
};

export const querySessionToolName = QUERY_SESSION_TOOL_NAME;
