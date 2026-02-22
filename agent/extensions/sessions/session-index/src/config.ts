import { z } from 'zod';
import {
  loadJsonConfig,
  type ConfigLoadResult,
} from '../../shared/config-loader';

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

export type SessionIndexConfigLoadResult = ConfigLoadResult<SessionIndexConfig>;

const getDefaultConfig = (): SessionIndexConfig =>
  SessionIndexConfigSchema.parse({});

const loadSessionIndexConfig = (): SessionIndexConfigLoadResult =>
  loadJsonConfig({
    importMetaUrl: import.meta.url,
    configFileName: 'session-index.config.json',
    schema: SessionIndexConfigSchema,
    defaultConfig: getDefaultConfig(),
  });

export const sessionIndexConfigLoadResult = loadSessionIndexConfig();
