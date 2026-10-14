import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { JsonSchema, SceneSpec } from '@reelcraft/shared';
import { WhiteboardAssetRegistry } from './asset.registry';
import { sceneSpecGuide, sceneSpecJsonSchema } from './scene-spec-schema';

const registry = new WhiteboardAssetRegistry();

const sample = {
  version: 1,
  title: 'How habits work',
  assetNeeds: [
    { id: 'morning-mug', label: 'Mug', description: 'A steaming mug', fallbackId: 'coffee-mug' },
  ],
  scenes: [
    {
      id: 'intro',
      template: 'title',
      title: 'How habits work',
      narration: 'Habits run your day.',
      camera: 'focus',
      slots: [
        { slot: 'main', asset: 'brain' },
        { slot: 'subtitle', text: 'small changes', emphasis: 'underline' },
      ],
    },
    {
      id: 'free-one',
      template: 'free',
      narration: 'Any layout.',
      slots: [
        { slot: 'a', text: 'Hi', cue: 'any layout', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 } },
      ],
    },
  ],
};

describe('sceneSpecJsonSchema', () => {
  it('is in the restricted dialect and accepts a plan Reelcraft accepts', () => {
    const schema = sceneSpecJsonSchema(registry);
    expect(JsonSchema.safeParse(schema).success).toBe(true);
    expect(SceneSpec.safeParse(sample).success).toBe(true);
    const validate = new Ajv({ strict: false }).compile(schema);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a plan with a bad template or no scenes', () => {
    const validate = new Ajv({ strict: false }).compile(sceneSpecJsonSchema());
    expect(validate({ ...sample, scenes: [] })).toBe(false);
    expect(validate({ ...sample, scenes: [{ ...sample.scenes[0], template: 'poster' }] })).toBe(
      false,
    );
  });

  it('tells the model every layout and, when it can, the built-in drawings', () => {
    const text = JSON.stringify(sceneSpecJsonSchema(registry));
    for (const template of ['title', 'three_step', 'before_after', 'free']) {
      expect(text).toContain(template);
    }
    expect(text).toContain('lightbulb');
    expect(JSON.stringify(sceneSpecJsonSchema())).not.toContain('lightbulb');
  });
});

describe('sceneSpecGuide', () => {
  it('lists the layouts and every built-in drawing with its meaning', () => {
    const guide = sceneSpecGuide(registry);
    expect(guide).toContain('three_step:');
    expect(guide).toContain('lightbulb: Lightbulb, an idea');
    expect(guide.split('\n').length).toBeGreaterThan(registry.list().length);
  });
});
