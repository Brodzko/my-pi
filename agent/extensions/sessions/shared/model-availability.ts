import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';

export type ConfiguredTextModel = {
  model: Model<Api>;
  apiKey?: string;
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

  return {
    selected: {
      model: selectedModel,
      apiKey: await ctx.modelRegistry.getApiKey(selectedModel),
    },
    missingModelKeys,
  };
};
