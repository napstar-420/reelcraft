import { describe, expect, it } from 'vitest';
import { nextModelPinForModel, visibleParams } from './model-pin-editor.logic';
import type { ModelInfoDto } from '@reelcraft/shared';

describe('Codex model pin editor logic', () => {
  const model: ModelInfoDto = {
    providerId: 'codex',
    modelId: 'gpt-example',
    label: 'Example',
    modalities: ['text'],
    supportedReasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'low',
  };

  it('preserves a compatible effort and defaults an incompatible effort', () => {
    expect(
      nextModelPinForModel({ provider: 'codex', params: { reasoningEffort: 'high' } }, model),
    ).toMatchObject({ modelId: 'gpt-example', params: { reasoningEffort: 'high' } });
    expect(
      nextModelPinForModel({ provider: 'codex', params: { reasoningEffort: 'medium' } }, model),
    ).toMatchObject({ modelId: 'gpt-example', params: { reasoningEffort: 'low' } });
  });

  it('hides the reserved effort key from generic params', () => {
    expect(visibleParams({ reasoningEffort: 'high', personality: 'concise' }, 'codex')).toEqual({
      personality: 'concise',
    });
  });

  it('retains normal version and params behavior for other providers', () => {
    const openRouter: ModelInfoDto = {
      providerId: 'openrouter',
      modelId: 'openai/example',
      label: 'Example',
      modalities: ['text'],
    };
    expect(
      nextModelPinForModel(
        { provider: 'openrouter', version: 'snapshot', params: { reasoningEffort: 'raw' } },
        openRouter,
      ),
    ).toMatchObject({ modelId: 'openai/example', version: 'snapshot' });
    expect(visibleParams({ reasoningEffort: 'raw' }, 'openrouter')).toEqual({
      reasoningEffort: 'raw',
    });
  });
});
