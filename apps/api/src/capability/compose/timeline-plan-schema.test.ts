import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { JsonSchema, TimelinePlan } from '@reelcraft/shared';
import { TIMELINE_PLAN_GUIDE, timelinePlanJsonSchema } from './timeline-plan-schema';

const sample = {
  version: 1,
  background: '#fbfaf5',
  world: { width: 2, height: 1 },
  camera: [{ atSec: 3, x: 1.5, y: 0.5, zoom: 1, ease: 'in_out' }],
  ducks: [{ track: 'music', under: 'voice' }],
  layers: [
    { kind: 'audio', asset: 'voice', track: 'voice' },
    { kind: 'audio', asset: 'song', track: 'music', loop: true, volume: 0.15 },
    { kind: 'image', asset: 'photo', x: 0, y: 0, w: 1, h: 1, anim: 'fade' },
    {
      kind: 'drawing',
      asset: 'lightbulb',
      x: 0.4,
      y: 0.2,
      w: 0.2,
      h: 0.3,
      atCue: 'an idea',
      anim: 'draw',
      keyframes: [{ atSec: 1, y: -0.02 }],
    },
    { kind: 'text', text: 'Hello', x: 0.1, y: 0.1, w: 0.3, h: 0.1, font: 'Inter', weight: 800 },
    { kind: 'captions' },
  ],
};

describe('timelinePlanJsonSchema', () => {
  it('is in the restricted dialect and accepts a plan Reelcraft accepts', () => {
    const schema = timelinePlanJsonSchema();
    expect(JsonSchema.safeParse(schema).success).toBe(true);
    expect(TimelinePlan.safeParse(sample).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a plan with no layers or a layer of a kind that does not exist', () => {
    const validate = new Ajv({ strict: false }).compile(timelinePlanJsonSchema());
    expect(validate({ ...sample, layers: [] })).toBe(false);
    expect(validate({ ...sample, layers: [{ kind: 'hologram' }] })).toBe(false);
  });

  it('offers every kind of layer and every animation', () => {
    const text = JSON.stringify(timelinePlanJsonSchema());
    for (const word of [
      'image',
      'video',
      'audio',
      'drawing',
      'captions',
      'handwrite',
      'highlight',
    ]) {
      expect(text).toContain(word);
    }
  });

  it('explains how a plan places things, without naming any one style', () => {
    expect(TIMELINE_PLAN_GUIDE).toContain('atCue');
    expect(TIMELINE_PLAN_GUIDE.toLowerCase()).not.toContain('whiteboard');
  });
});
