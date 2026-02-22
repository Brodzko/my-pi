import { complete } from '@mariozechner/pi-ai';
import type { AssistantMessage, Usage } from '@mariozechner/pi-ai';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { z } from 'zod';
import { toErrorMessage } from '../../shared/feedback';
import {
  extractLikelyJsonObject,
  getResponseText,
} from '../../shared/llm-json';
import { resolveTextModelAvailability } from '../../shared/model-availability';
import type { QuerySessionConfig } from './types';

const MAX_RETRIES = 2;

const QueryModelOutputSchema = z.object({
  answerMarkdown: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  citations: z
    .array(
      z.object({
        entryId: z.string().min(1),
        role: z.enum(['user', 'assistant']),
        excerpt: z.string().min(1).max(280),
      })
    )
    .max(8)
    .optional(),
});

type QueryModelOutput = z.infer<typeof QueryModelOutputSchema>;

export type QueryGenerateResult = {
  output: QueryModelOutput;
  usage: Usage;
  model: string;
};

type QueryGenerateParams = {
  ctx: ExtensionContext;
  conversationText: string;
  question: string;
  config: QuerySessionConfig;
};

type QueryGenerateErrorKind =
  | 'model_unavailable'
  | 'transport'
  | 'malformed_output';

export class QueryGenerateError extends Error {
  kind: QueryGenerateErrorKind;
  usage?: Usage;
  model?: string;

  constructor(
    kind: QueryGenerateErrorKind,
    message: string,
    options?: { usage?: Usage; model?: string }
  ) {
    super(message);
    this.name = 'QueryGenerateError';
    this.kind = kind;
    this.usage = options?.usage;
    this.model = options?.model;
  }
}

const SYSTEM_PROMPT =
  'You answer questions about a past coding session. Use only the provided session context. Return valid JSON only.';

const buildBasePrompt = (conversationText: string, question: string): string =>
  `Use only the provided session context to answer the question.
If there is not enough evidence in the context, say that explicitly.
Keep the answer concise, specific, and in markdown.

Return exactly one JSON object with this shape:
{
  "answerMarkdown": "markdown answer",
  "confidence": "high | medium | low",
  "citations": [
    {
      "entryId": "entry id from context",
      "role": "user | assistant",
      "excerpt": "short supporting quote"
    }
  ]
}

Citations are optional. If included, keep 1-4 citations and use only entry ids present in context.
No markdown fences. No extra text.

<session_context>
${conversationText}
</session_context>

<question>
${question}
</question>`;

const buildRetryPrompt = (
  conversationText: string,
  question: string,
  previousRawResponse: string,
  validationError: string
): string =>
  `${buildBasePrompt(conversationText, question)}

Your previous response was invalid.

Previous response:
${previousRawResponse}

Validation or parse errors:
${validationError}

Return exactly one valid JSON object matching the required schema.`;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Model call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const generateQueryAnswer = async ({
  ctx,
  conversationText,
  question,
  config,
}: QueryGenerateParams): Promise<QueryGenerateResult> => {
  const modelAvailability = await resolveTextModelAvailability(
    ctx,
    config.modelKeys
  );

  const configuredModel = modelAvailability.selected;
  if (!configuredModel) {
    throw new QueryGenerateError(
      'model_unavailable',
      `Configured query model unavailable: ${modelAvailability.missingModelKeys.join(', ')}`
    );
  }

  const modelName = `${configuredModel.model.provider}/${configuredModel.model.id}`;

  let previousRawResponse = '';
  let previousError = '';
  let lastUsage: Usage | undefined;

  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    const prompt =
      retry === 0
        ? buildBasePrompt(conversationText, question)
        : buildRetryPrompt(
            conversationText,
            question,
            previousRawResponse,
            previousError
          );

    let response: AssistantMessage;

    try {
      response = await withTimeout(
        complete(
          configuredModel.model,
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
          configuredModel.apiKey
            ? { apiKey: configuredModel.apiKey }
            : undefined
        ),
        config.timeoutMs
      );
    } catch (error) {
      const message = toErrorMessage(error, 'Unknown model transport error');

      throw new QueryGenerateError('transport', message, { model: modelName });
    }

    lastUsage = response.usage;

    const raw = getResponseText(response.content);

    try {
      if (!raw) {
        throw new Error('Empty model output');
      }

      const jsonCandidate = extractLikelyJsonObject(raw);
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const output = QueryModelOutputSchema.parse(parsed);

      return {
        output,
        usage: response.usage,
        model: modelName,
      };
    } catch (error) {
      previousRawResponse = raw;
      previousError = toErrorMessage(error, 'Unknown parse error');

      if (retry === MAX_RETRIES) {
        throw new QueryGenerateError(
          'malformed_output',
          `Malformed query model output after ${MAX_RETRIES + 1} attempts: ${previousError}`,
          {
            usage: lastUsage,
            model: modelName,
          }
        );
      }
    }
  }

  throw new QueryGenerateError(
    'malformed_output',
    'Unexpected malformed output state',
    {
      usage: lastUsage,
      model: modelName,
    }
  );
};
