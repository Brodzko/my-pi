import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SessionIndexConfigSchema = z
  .object({
    commandName: z.string().min(1).default('index-session'),
    statusKey: z.string().min(1).default('index-session'),
    minNewUserMessages: z.number().int().min(1).default(5),
    notificationAutoClearMs: z.number().int().min(0).default(3000),
    modelKeys: z
      .array(z.string().min(1))
      .min(1)
      .default(['google-gemini-cli/gemini-2.5-flash']),
  })
  .strict();

export type SessionIndexConfig = z.infer<typeof SessionIndexConfigSchema>;

export type SessionIndexConfigLoadResult = {
  path: string;
  config: SessionIndexConfig;
  valid: boolean;
  errors: string[];
};

const extensionDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const configPath = path.join(extensionDir, 'session-index.config.json');

const getDefaultConfig = (): SessionIndexConfig =>
  SessionIndexConfigSchema.parse({});

const prettifyZodError = (error: z.ZodError): string[] =>
  z
    .prettifyError(error)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

const loadSessionIndexConfig = (): SessionIndexConfigLoadResult => {
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

  const parsedConfig = SessionIndexConfigSchema.safeParse(parsedJson);
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

export const sessionIndexConfigLoadResult = loadSessionIndexConfig();
