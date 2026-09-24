import { describe, expect, it } from 'vitest';
import { StageDef } from './stage-def';

describe('StageDef', () => {
  it('round-trips the §25.1 worked example\'s "script" stage', () => {
    const raw = {
      key: 'script',
      label: 'Script',
      capability: 'text.generate',
      instructions: { template: 'Write a short narration script about {{ topic }}.' },
      config: {},
      slots: {},
      context: {
        topic: { from: 'input', inputKey: 'topic' },
      },
      writes: { script: '$' },
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { narration: { type: 'string' } },
          required: ['narration'],
        },
      },
      checks: [],
      retryLimit: 2,
      model: { provider: 'fake', modelId: 'fake-text-1' },
    };

    const parsed = StageDef.parse(raw);
    expect(parsed.capability).toBe('text.generate');
    expect(parsed.output.kind).toBe('data');
    expect(parsed.context.topic).toEqual({ from: 'input', inputKey: 'topic' });

    // round-trip: parsed value re-parses to an equivalent shape
    const reparsed = StageDef.parse(parsed);
    expect(reparsed).toEqual(parsed);
  });

  it('rejects a Ref with the removed {from: "stage"} variant', () => {
    expect(() =>
      StageDef.parse({
        key: 'x',
        label: 'X',
        capability: 'text.generate',
        config: {},
        slots: { bad: { from: 'stage', stageKey: 'script' } },
        context: {},
        output: { kind: 'text' },
        checks: [],
        retryLimit: 0,
      }),
    ).toThrow();
  });
});
