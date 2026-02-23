import { z } from 'zod';
import {
  loadJsonConfig,
  type ConfigLoadResult,
} from '../../shared/config-loader';

const SessionNotifyConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    statusKey: z.string().min(1).default('session-notify'),
    notificationAutoClearMs: z.number().int().min(0).default(4000),
    soundMode: z.literal('terminal-bell').default('terminal-bell'),
    bellCount: z.number().int().min(1).max(5).default(1),
  })
  .strict();

export type SessionNotifyConfig = z.infer<typeof SessionNotifyConfigSchema>;

export type SessionNotifyConfigLoadResult =
  ConfigLoadResult<SessionNotifyConfig>;

const getDefaultConfig = (): SessionNotifyConfig =>
  SessionNotifyConfigSchema.parse({});

const loadSessionNotifyConfig = (): SessionNotifyConfigLoadResult =>
  loadJsonConfig({
    importMetaUrl: import.meta.url,
    configFileName: 'session-notify.config.json',
    schema: SessionNotifyConfigSchema,
    defaultConfig: getDefaultConfig(),
  });

export const sessionNotifyConfigLoadResult = loadSessionNotifyConfig();
