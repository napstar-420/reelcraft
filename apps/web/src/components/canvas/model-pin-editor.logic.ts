import type { ModelInfoDto, PartialModelPin } from '@reelcraft/shared';

export function visibleParams(
  params: Record<string, unknown> | undefined,
  provider: string | undefined,
): Record<string, unknown> {
  const next = { ...(params ?? {}) };
  if (provider === 'codex') delete next.reasoningEffort;
  return next;
}

export function nextModelPinForModel(
  current: PartialModelPin,
  model: ModelInfoDto,
): PartialModelPin {
  if (model.providerId !== 'codex') return { ...current, modelId: model.modelId };
  const supported = model.supportedReasoningEfforts ?? [];
  const currentEffort = current.params?.reasoningEffort;
  const reasoningEffort =
    typeof currentEffort === 'string' && supported.includes(currentEffort)
      ? currentEffort
      : model.defaultReasoningEffort;
  return {
    ...current,
    provider: 'codex',
    modelId: model.modelId,
    version: undefined,
    params: { ...(current.params ?? {}), ...(reasoningEffort && { reasoningEffort }) },
  };
}
