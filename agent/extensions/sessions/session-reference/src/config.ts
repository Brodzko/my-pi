import { z } from 'zod';
import {
  loadJsonConfig,
  type ConfigLoadResult,
} from '../../shared/config-loader';

export type SessionReferenceConfig = {
  enabled: boolean;
  statusKey: string;
  notificationAutoClearMs: number;
  maxRefsPerPrompt: number;
  maxInjectedBytes: number;
  debugDisplayInjectedMessage: boolean;
};

export type SessionReferenceConfigLoadResult =
  ConfigLoadResult<SessionReferenceConfig>;

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

const getDefaultConfig = (): SessionReferenceConfig =>
  SessionReferenceConfigSchema.parse({});

const loadSessionReferenceConfig = (): SessionReferenceConfigLoadResult =>
  loadJsonConfig({
    importMetaUrl: import.meta.url,
    configFileName: 'session-reference.config.json',
    schema: SessionReferenceConfigSchema,
    defaultConfig: getDefaultConfig(),
  });

export const sessionReferenceConfigLoadResult = loadSessionReferenceConfig();
