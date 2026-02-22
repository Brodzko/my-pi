import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export type SessionReferenceConfig = {
  enabled: boolean;
  statusKey: string;
  notificationAutoClearMs: number;
  maxRefsPerPrompt: number;
  maxInjectedBytes: number;
  debugDisplayInjectedMessage: boolean;
};

export type SessionReferenceConfigLoadResult = {
  path: string;
  config: SessionReferenceConfig;
  valid: boolean;
  errors: string[];
};

const SessionReferenceConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    statusKey: z.string().min(1).default('session-reference'),
    notificationAutoClearMs: z.number().int().min(0).default(3000),
    maxRefsPerPrompt: z.number().int().min(1).default(3),
    maxInjectedBytes: z.number().int().min(1).default(12_000),
    debugDisplayInjectedMessage: z.boolean().default(false),
  })
  .strict();

const extensionDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const configPath = path.join(extensionDir, 'session-reference.config.json');

const getDefaultConfig = (): SessionReferenceConfig =>
  SessionReferenceConfigSchema.parse({});

const prettifyZodError = (error: z.ZodError): string[] =>
  z
    .prettifyError(error)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

const loadSessionReferenceConfig = (): SessionReferenceConfigLoadResult => {
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

  const parsedConfig = SessionReferenceConfigSchema.safeParse(parsedJson);
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

export const sessionReferenceConfigLoadResult = loadSessionReferenceConfig();
