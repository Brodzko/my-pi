import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';

export type ConfiguredTextModel = {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type TextModelAvailability = {
  selected: ConfiguredTextModel | undefined;
  missingModelKeys: string[];
};

const isTextModel = (model: Model<Api>): boolean =>
  model.input.includes('text');

export const resolveTextModelAvailability = async (
  ctx: ExtensionContext,
  modelKeys: string[]
): Promise<TextModelAvailability> => {
  const availableModels = ctx.modelRegistry.getAvailable().filter(isTextModel);
  const modelsByKey = new Map(
    availableModels.map(model => [`${model.provider}/${model.id}`, model])
  );

  const missingModelKeys = modelKeys.filter(
    modelKey => !modelsByKey.has(modelKey)
  );

  const selectedKey = modelKeys.find(modelKey => modelsByKey.has(modelKey));
  if (!selectedKey) {
    return {
      selected: undefined,
      missingModelKeys,
    };
  }

  const selectedModel = modelsByKey.get(selectedKey);
  if (!selectedModel) {
    return {
      selected: undefined,
      missingModelKeys,
    };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(selectedModel);

  return {
    selected: {
      model: selectedModel,
      ...(auth.ok ? { apiKey: auth.apiKey, headers: auth.headers } : {}),
    },
    missingModelKeys,
  };
};
