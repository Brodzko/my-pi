import { complete } from '@mariozechner/pi-ai';
import type { Api, Model, Usage } from '@mariozechner/pi-ai';
import { z } from 'zod';
import { toErrorMessage } from '../../shared/feedback';
import {
  extractLikelyJsonObject,
  getResponseText,
} from '../../shared/llm-json';
import type { HandoffContextPayload } from './context';

const MAX_RETRIES = 2;

const SYSTEM_PROMPT =
  'You create high-signal handoff notes for engineering threads. Return JSON only.';

const GeneratedHandoffSchema = z.object({
  handoffMarkdown: z.string().min(1).max(20_000),
});

type GeneratedHandoff = z.infer<typeof GeneratedHandoffSchema>;

export type HandoffGenerateAttempt = {
  success: boolean;
  model: string;
  timestamp: string;
  usage?: Usage;
  error?: string;
};

type GenerateHandoffSummaryParams = {
  model: Model<Api>;
  apiKey?: string;
  context: HandoffContextPayload;
  cwd: string;
  onAttempt: (attempt: HandoffGenerateAttempt) => void;
  onStatus: (message: string) => void;
};

type GenerateHandoffSummaryResult = {
  handoffMarkdown: string;
  usage: Usage;
  model: string;
};

const formatTouchedFiles = (paths: string[]): string => {
  if (paths.length === 0) {
    return '- none detected from tool calls';
  }

  return paths.map(path => `- ${path}`).join('\n');
};

const buildBasePrompt = (context: HandoffContextPayload, cwd: string): string =>
  `You are preparing a handoff prompt that will be pasted into a brand new coding-agent session.
Summarize the provided transcript for a senior engineer continuing the work.

Return exactly one JSON object:
{
  "handoffMarkdown": "markdown summary"
}

The markdown MUST use these sections in this exact order:
## Goal
## Progress
## Hurdles
## Touched Files
## Next Steps

Requirements:
- Be concrete and detailed. Include decisions, attempted approaches, and unresolved risks.
- In Hurdles, include blockers, uncertainties, or things that failed.
- In Touched Files, list explicit paths when known. If unknown, state that clearly.
- In Next Steps, make it action-oriented and prioritized.
- If context is missing, say so explicitly instead of guessing.
- No markdown code fences.

<session_facts>
- cwd: ${cwd}
- serializedBytes: ${context.serializedBytes}
- conversationTruncated: ${context.truncated ? 'yes' : 'no'}
- userMessages: ${context.stats.userMessageCount}
- assistantMessages: ${context.stats.assistantMessageCount}
- toolCalls: ${context.stats.toolCallCount}
- touchedFileHints:
${formatTouchedFiles(context.touchedFiles)}
</session_facts>

<conversation>
${context.conversationText}
</conversation>`;

const buildRetryPrompt = (
  context: HandoffContextPayload,
  cwd: string,
  previousRawResponse: string,
  validationError: string
): string =>
  `${buildBasePrompt(context, cwd)}

Your previous response was invalid.

Previous response:
${previousRawResponse}

Validation or parse errors:
${validationError}

Return exactly one valid JSON object matching the schema.`;

export const generateHandoffSummary = async ({
  model,
  apiKey,
  context,
  cwd,
  onAttempt,
  onStatus,
}: GenerateHandoffSummaryParams): Promise<GenerateHandoffSummaryResult> => {
  const modelName = `${model.provider}/${model.id}`;

  let previousRawResponse = '';
  let previousError = '';

  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    onStatus(
      retry === 0
        ? '⏳ generating handoff summary...'
        : `⏳ generating handoff summary... (retry ${retry}/${MAX_RETRIES})`
    );

    const prompt =
      retry === 0
        ? buildBasePrompt(context, cwd)
        : buildRetryPrompt(context, cwd, previousRawResponse, previousError);

    let response: Awaited<ReturnType<typeof complete>>;

    try {
      response = await complete(
        model,
        {
          systemPrompt: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        apiKey ? { apiKey } : undefined
      );
    } catch (error) {
      const message = toErrorMessage(error, 'Unknown handoff model error');

      onAttempt({
        success: false,
        model: modelName,
        timestamp: new Date().toISOString(),
        error: message,
      });

      throw new Error(message);
    }

    const raw = getResponseText(response.content);

    try {
      if (!raw) {
        throw new Error('Empty model output');
      }

      const parsed = JSON.parse(extractLikelyJsonObject(raw));
      const generated = GeneratedHandoffSchema.parse(
        parsed
      ) as GeneratedHandoff;

      onAttempt({
        success: true,
        model: modelName,
        timestamp: new Date().toISOString(),
        usage: response.usage,
      });

      return {
        handoffMarkdown: generated.handoffMarkdown,
        usage: response.usage,
        model: modelName,
      };
    } catch (error) {
      previousRawResponse = raw;
      previousError = toErrorMessage(error, 'Unknown parse error');

      onAttempt({
        success: false,
        model: modelName,
        timestamp: new Date().toISOString(),
        usage: response.usage,
        error: previousError,
      });

      if (retry === MAX_RETRIES) {
        throw new Error(
          `Malformed handoff model output after ${MAX_RETRIES + 1} attempts: ${previousError}`
        );
      }
    }
  }

  throw new Error('Unexpected handoff generation failure');
};
