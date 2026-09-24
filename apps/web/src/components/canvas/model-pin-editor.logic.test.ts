import { describe, expect, it } from 'vitest';
import { nextModelPinForModel, visibleParams } from './model-pin-editor.logic';

describe('Codex model pin editor logic', () => {
  const model = {
    providerId: 'codex',
    modelId: 'gpt-example',
    label: 'Example',
    modality: 'text' as const,
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
});
