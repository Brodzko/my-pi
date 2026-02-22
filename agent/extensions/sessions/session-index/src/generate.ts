import { complete } from '@mariozechner/pi-ai';
import type { Api, Model, Usage } from '@mariozechner/pi-ai';
import { z } from 'zod';
import { toErrorMessage } from '../../shared/feedback';
import {
  extractLikelyJsonObject,
  getResponseText,
} from '../../shared/llm-json';

const MAX_RETRIES = 2;

const SYSTEM_PROMPT =
  'You are a session archivist. Return only valid JSON with no markdown fences or extra text.';

const GeneratedMetaSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1200),
  summary: z.string().min(1).max(8000),
  tags: z.array(z.string().min(1).max(80)).min(3).max(12),
});

type GeneratedMeta = z.infer<typeof GeneratedMetaSchema>;

export type GenerateAttempt = {
  success: boolean;
  sessionId: string;
  model: string;
  timestamp: string;
  usage?: Usage;
  error?: string;
};

type GenerateSessionMetaResult = {
  meta: GeneratedMeta;
  usage: Usage;
  model: string;
};

type GenerateSessionMetaParams = {
  conversationText: string;
  sessionId: string;
  model: Model<Api>;
  apiKey?: string;
  onStatus: (status: string) => void;
  onAttempt: (attempt: GenerateAttempt) => void;
};

const buildBasePrompt = (
  conversationText: string
) => `You are a session archivist for a developer using an AI coding assistant.
Given a conversation transcript, extract structured metadata to make the session
searchable and useful for future reference.

Respond with a single valid JSON object — no markdown fences, no explanation, nothing else.
Your response MUST start with "{" and MUST end with "}".
Do not wrap JSON in triple-backtick fences.

<conversation>
${conversationText}
</conversation>

Required output:
{
  "name": "Short descriptive title, 5–8 words, sentence case, no trailing punctuation",
  "description": "2–3 plain English sentences. What was being worked on, what was decided or resolved. Written for a developer scanning a list of past sessions.",
  "summary": "Structured markdown. Use these sections: ## Goal, ## Key Decisions, ## Outcome. Keep each section to 2–5 bullet points or 2–3 sentences. If the session is unfinished, add ## Next Steps instead of or alongside Outcome.",
  "tags": ["3 to 12 concise tags", "include specific entities when mentioned", "no filler words"]
}

Tagging rules:
- If tickets/issues/PRs are mentioned, include structured entity tags like "ticket:ABC-123" or "ticket:#1234".
- If Slack threads/channels are mentioned, include structured tags like "slack:thread", "slack:channel", and include an identifier tag when available (for example "slack:eng-platform").
- Keep tags short and searchable; include both broad topic tags and entity tags when useful.
- Do not invent identifiers that are not present in the conversation.`;

const buildRetryPrompt = (
  conversationText: string,
  previousRawResponse: string,
  validationError: string
): string =>
  `${buildBasePrompt(conversationText)}

Your previous response was invalid.

Previous response:
${previousRawResponse}

Validation or parse errors:
${validationError}

Return exactly one valid JSON object matching the required schema.
Do not include markdown fences or any extra text.
Your response MUST start with "{" and MUST end with "}".`;

export const generateSessionMeta = async ({
  conversationText,
  sessionId,
  model,
  apiKey,
  onStatus,
  onAttempt,
}: GenerateSessionMetaParams): Promise<GenerateSessionMetaResult> => {
  const modelName = `${model.provider}/${model.id}`;

  let previousRawResponse = '';
  let previousError = '';

  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    if (retry === 0) {
      onStatus('⏳ indexing...');
    } else {
      onStatus(`⏳ indexing... (retry ${retry}/${MAX_RETRIES})`);
    }

    const prompt =
      retry === 0
        ? buildBasePrompt(conversationText)
        : buildRetryPrompt(
            conversationText,
            previousRawResponse,
            previousError
          );

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
      const errorMessage = toErrorMessage(error, 'Unknown model error');
      onAttempt({
        success: false,
        sessionId,
        model: modelName,
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }

    const raw = getResponseText(response.content);

    try {
      if (!raw) {
        const stopReason = response.stopReason ?? 'unknown';
        const providerError = response.errorMessage?.trim();

        throw new Error(
          providerError
            ? `Empty model output (stopReason: ${stopReason}, providerError: ${providerError})`
            : `Empty model output (stopReason: ${stopReason})`
        );
      }

      const jsonCandidate = extractLikelyJsonObject(raw);
      const parsed = JSON.parse(jsonCandidate);
      const meta = GeneratedMetaSchema.parse(parsed);

      onAttempt({
        success: true,
        sessionId,
        model: modelName,
        timestamp: new Date().toISOString(),
        usage: response.usage,
      });

      return {
        meta,
        usage: response.usage,
        model: modelName,
      };
    } catch (error) {
      previousRawResponse = raw;
      previousError = toErrorMessage(error, 'Unknown parse error');

      onAttempt({
        success: false,
        sessionId,
        model: modelName,
        timestamp: new Date().toISOString(),
        usage: response.usage,
        error: previousError,
      });

      if (retry === MAX_RETRIES) {
        throw new Error(
          `Malformed model output after ${MAX_RETRIES + 1} attempts: ${previousError}`
        );
      }
    }
  }

  throw new Error('Unexpected indexing failure');
};
