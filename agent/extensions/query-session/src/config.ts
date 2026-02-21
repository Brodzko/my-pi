import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { QuerySessionConfig, QuerySessionConfigLoadResult } from './types';

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

const extensionDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const configPath = path.join(extensionDir, 'query-session.config.json');

const getDefaultConfig = (): QuerySessionConfig =>
  QuerySessionConfigSchema.parse({});

const prettifyZodError = (error: z.ZodError): string[] =>
  z
    .prettifyError(error)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

const loadQuerySessionConfig = (): QuerySessionConfigLoadResult => {
  const defaultConfig = getDefaultConfig();

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown file read error';

    return {
      path: configPath,
      config: defaultConfig,
      valid: false,
      errors: [`Failed to read config file: ${message}`],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown JSON parse error';

    return {
      path: configPath,
      config: defaultConfig,
      valid: false,
      errors: [`Invalid JSON: ${message}`],
    };
  }

  const parsedConfig = QuerySessionConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    return {
      path: configPath,
      config: defaultConfig,
      valid: false,
      errors: prettifyZodError(parsedConfig.error),
    };
  }

  return {
    path: configPath,
    config: parsedConfig.data,
    valid: true,
    errors: [],
  };
};

export const querySessionConfigLoadResult = loadQuerySessionConfig();
