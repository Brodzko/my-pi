import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

export const formatUsdCost = (costUsd: number): string =>
  costUsd >= 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(6);

export const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const formatConfigErrors = (errors: string[]): string =>
  errors.map(error => `• ${error}`).join('\n');

export const notifyInvalidConfig = (
  ctx: ExtensionContext,
  options: {
    featureName: string;
    configPath: string;
    errors: string[];
  }
): void => {
  const formattedErrors = formatConfigErrors(options.errors);

  ctx.ui.notify(
    `${options.featureName} disabled. Invalid config at ${options.configPath}\n${formattedErrors}`,
    'warning'
  );
};

export const notifyMissingModels = (
  ctx: ExtensionContext,
  options: {
    featureName: string;
    missingModelKeys: string[];
  }
): void => {
  ctx.ui.notify(
    `${options.featureName} disabled. Missing configured model(s): ${options.missingModelKeys.join(', ')}`,
    'warning'
  );
};
