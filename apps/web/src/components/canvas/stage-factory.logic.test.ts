import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { createStage, defaultOutput, nextStageKey, nextStageLabel } from './stage-factory.logic';

function stage(key: string, label = key): StageDef {
  return {
    key,
    label,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
  };
}

describe('nextStageKey', () => {
  it('starts at stage-1 and fills the first free number', () => {
    expect(nextStageKey([])).toBe('stage-1');
    expect(nextStageKey([stage('stage-1'), stage('stage-3')])).toBe('stage-2');
  });
});

describe('nextStageLabel', () => {
  it('uses the capability label, numbering repeats', () => {
    expect(nextStageLabel([], 'Generate Text')).toBe('Generate Text');
    expect(nextStageLabel([stage('a', 'Generate Text')], 'Generate Text')).toBe('Generate Text 2');
    expect(
      nextStageLabel([stage('a', 'Generate Text'), stage('b', 'Generate Text 2')], 'Generate Text'),
    ).toBe('Generate Text 3');
  });
});

describe('defaultOutput', () => {
  it('takes the first allowed kind that needs no schema', () => {
    expect(defaultOutput(['media.image'])).toEqual({ kind: 'media.image' });
    expect(defaultOutput(['data', 'text'])).toEqual({ kind: 'text' });
  });

  it('falls back to an empty object schema when only data is allowed', () => {
    expect(defaultOutput(['data'])).toEqual({ kind: 'data', schema: { type: 'object' } });
    expect(defaultOutput([])).toEqual({ kind: 'data', schema: { type: 'object' } });
  });
});

describe('createStage', () => {
  it('builds an empty stage with a unique key and label', () => {
    const graph = [stage('stage-1', 'Generate Text')];
    const created = createStage(graph, { key: 'text.generate', label: 'Generate Text' }, ['text']);
    expect(created).toMatchObject({
      key: 'stage-2',
      label: 'Generate Text 2',
      capability: 'text.generate',
      output: { kind: 'text' },
      slots: {},
      context: {},
      checks: [],
    });
  });
});
