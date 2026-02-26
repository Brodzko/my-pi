import { DEFAULT_MAX_BYTES } from '@mariozechner/pi-coding-agent';
import { z } from 'zod';
import {
  loadJsonConfig,
  type ConfigLoadResult,
} from '../../shared/config-loader';

const SessionHandoffConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    commandName: z.string().min(1).default('handoff'),
    statusKey: z.string().min(1).default('session-handoff'),
    notificationAutoClearMs: z.number().int().min(0).default(4000),
    modelKeys: z
      .array(z.string().min(1))
      .min(1)
      .default(['openai-codex/gpt-5.1-codex-mini', 'openai-codex/gpt-5.1']),
    maxBytes: z.number().int().min(1).default(DEFAULT_MAX_BYTES),
  })
  .strict();

export type SessionHandoffConfig = z.infer<typeof SessionHandoffConfigSchema>;

export type SessionHandoffConfigLoadResult =
  ConfigLoadResult<SessionHandoffConfig>;

const getDefaultConfig = (): SessionHandoffConfig =>
  SessionHandoffConfigSchema.parse({});

const loadSessionHandoffConfig = (): SessionHandoffConfigLoadResult =>
  loadJsonConfig({
    importMetaUrl: import.meta.url,
    configFileName: 'session-handoff.config.json',
    schema: SessionHandoffConfigSchema,
    defaultConfig: getDefaultConfig(),
  });

export const sessionHandoffConfigLoadResult = loadSessionHandoffConfig();
