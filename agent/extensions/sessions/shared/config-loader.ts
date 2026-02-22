import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export type ConfigLoadResult<TConfig> = {
  path: string;
  config: TConfig;
  valid: boolean;
  errors: string[];
};

export const prettifyZodError = (error: z.ZodError): string[] =>
  z
    .prettifyError(error)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

export const getExtensionDir = (importMetaUrl: string): string =>
  path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');

export const loadJsonConfig = <TConfig>(params: {
  importMetaUrl: string;
  configFileName: string;
  schema: z.ZodType<TConfig>;
  defaultConfig: TConfig;
}): ConfigLoadResult<TConfig> => {
  const extensionDir = getExtensionDir(params.importMetaUrl);
  const configPath = path.join(extensionDir, params.configFileName);

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown file read error';

    return {
      path: configPath,
      config: params.defaultConfig,
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
      config: params.defaultConfig,
      valid: false,
      errors: [`Invalid JSON: ${message}`],
    };
  }

  const parsedConfig = params.schema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    return {
      path: configPath,
      config: params.defaultConfig,
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
