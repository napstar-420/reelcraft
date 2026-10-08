import { describe, expect, it } from 'vitest';
import { StageDef, approvalModeOf } from './stage-def';

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

describe('approvalModeOf', () => {
  const base: StageDef = {
    key: 'shots',
    label: 'Shots',
    capability: 'image.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'media.image' },
    checks: [],
  };
  const iterate = { over: { from: 'prev' as const }, itemAlias: 'shot', itemRetryLimit: 0 };

  it("reviews an iterating stage once, at its end, unless 'item' is asked for", () => {
    expect(approvalModeOf({ ...base, iterate })).toBe('stage');
    expect(approvalModeOf({ ...base, iterate, approval: { mode: 'stage' } })).toBe('stage');
    expect(approvalModeOf({ ...base, iterate, approval: { mode: 'item' } })).toBe('item');
  });

  it('is stage for a stage that does not iterate', () => {
    expect(approvalModeOf(base)).toBe('stage');
  });
});
