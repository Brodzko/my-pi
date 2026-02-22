import { z } from 'zod';
import {
  loadJsonConfig,
  type ConfigLoadResult,
} from '../../shared/config-loader';
import type { QuerySessionConfig } from './types';

const QuerySessionConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    statusKey: z.string().min(1).default('query-session'),
    notificationAutoClearMs: z.number().int().min(0).default(3000),
    modelKeys: z
      .array(z.string().min(1))
      .min(1)
      .default(['openai-codex/gpt-5.1-codex-mini']),
    maxBytes: z.number().int().min(1).default(160_000),
    maxCallsPerTurn: z.number().int().min(1).max(2).default(1),
    timeoutMs: z.number().int().min(1).default(15_000),
    useSessionsMeta: z.boolean().default(true),
  })
  .strict();

export type QuerySessionConfigLoadResult = ConfigLoadResult<QuerySessionConfig>;

const getDefaultConfig = (): QuerySessionConfig =>
  QuerySessionConfigSchema.parse({});

const loadQuerySessionConfig = (): QuerySessionConfigLoadResult =>
  loadJsonConfig({
    importMetaUrl: import.meta.url,
    configFileName: 'session-query.config.json',
    schema: QuerySessionConfigSchema,
    defaultConfig: getDefaultConfig(),
  });

export const querySessionConfigLoadResult = loadQuerySessionConfig();
