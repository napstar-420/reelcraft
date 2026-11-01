import { describe, expect, it } from 'vitest';
import { fixFailedStagePrompt } from './assistant-prompts';

describe('fixFailedStagePrompt', () => {
  it('names the run and stage by id, with the reason when there is one', () => {
    const text = fixFailedStagePrompt({
      runId: 'r1',
      runHandle: '#a1b2c3d4',
      blueprintName: 'Space facts',
      stageKey: 'images',
      stageLabel: 'Scene images',
      reason: 'The provider is down',
    });
    expect(text).toContain('runId r1');
    expect(text).toContain('“Space facts”');
    expect(text).toContain('stageKey images');
    expect(text).toContain('The error was: The provider is down');
    expect(
      fixFailedStagePrompt({
        runId: 'r1',
        runHandle: '#a',
        stageKey: 's',
        stageLabel: 'S',
        reason: null,
      }),
    ).not.toContain('error');
  });
});
