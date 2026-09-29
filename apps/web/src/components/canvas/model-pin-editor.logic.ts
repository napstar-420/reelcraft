import type { ModelInfoDto, PartialModelPin } from '@reelcraft/shared';

/** Pin params the editor renders with dedicated controls instead of the raw params list. */
const RESERVED_PARAMS: Record<string, string[]> = {
  codex: ['reasoningEffort'],
  chatgpt: ['reasoningEffort', 'webSearch'],
};

/** ChatGPT has no model picker: one fixed model id, tuned by effort + web search. */
export const CHATGPT_MODEL_ID = 'chatgpt';

export function reservedParams(provider: string | undefined): string[] {
  return RESERVED_PARAMS[provider ?? ''] ?? [];
}

export function visibleParams(
  params: Record<string, unknown> | undefined,
  provider: string | undefined,
): Record<string, unknown> {
  const next = { ...(params ?? {}) };
  for (const key of reservedParams(provider)) delete next[key];
  return next;
}

export function nextModelPinForProvider(
  current: PartialModelPin | undefined,
  provider: string | undefined,
): PartialModelPin {
  if (provider === 'chatgpt') {
    return {
      provider,
      modelId: CHATGPT_MODEL_ID,
      version: undefined,
      params: { reasoningEffort: 'medium', webSearch: false },
    };
  }
  return { ...current, provider, modelId: undefined, version: undefined };
}

export function nextModelPinForModel(
  current: PartialModelPin,
  model: ModelInfoDto,
): PartialModelPin {
  if (!reservedParams(model.providerId).includes('reasoningEffort')) {
    return { ...current, modelId: model.modelId };
  }
  const supported = model.supportedReasoningEfforts ?? [];
  const currentEffort = current.params?.reasoningEffort;
  const reasoningEffort =
    typeof currentEffort === 'string' && supported.includes(currentEffort)
      ? currentEffort
      : model.defaultReasoningEffort;
  return {
    ...current,
    provider: model.providerId,
    modelId: model.modelId,
    version: undefined,
    params: { ...(current.params ?? {}), ...(reasoningEffort && { reasoningEffort }) },
  };
}
