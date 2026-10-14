import { describe, expect, it } from 'vitest';
import { SceneSpec, VectorAssetSet } from './scene-spec';

const scene = (overrides: Record<string, unknown> = {}) => ({
  id: 'one',
  template: 'three_step',
  narration: 'One, two, three.',
  slots: [
    { slot: 'step1', text: 'One' },
    { slot: 'step2', text: 'Two' },
    { slot: 'step3', text: 'Three' },
  ],
  ...overrides,
});
const spec = (scenes: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  title: 'A video',
  scenes,
  ...extra,
});

describe('SceneSpec', () => {
  it('accepts every template with its own slots', () => {
    const good = [
      scene(),
      scene({
        id: 'ba',
        template: 'before_after',
        slots: [
          { slot: 'before', text: 'a' },
          { slot: 'after', asset: 'star' },
        ],
      }),
      scene({
        id: 'ps',
        template: 'problem_why_solution',
        slots: ['problem', 'why', 'solution'].map((slot) => ({ slot, text: slot })),
      }),
      scene({
        id: 't',
        template: 'title',
        title: 'Hello',
        slots: [{ slot: 'main', asset: 'brain' }],
      }),
      scene({
        id: 'f',
        template: 'free',
        slots: [{ slot: 'a', text: 'x', box: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
      }),
    ];
    expect(SceneSpec.safeParse(spec(good)).success).toBe(true);
  });

  it('rejects a slot the template does not have, and tells which are allowed', () => {
    const result = SceneSpec.safeParse(spec([scene({ slots: [{ slot: 'step9', text: 'x' }] })]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('step1, step2, step3');
  });

  it('needs every place of a sequence', () => {
    const result = SceneSpec.safeParse(spec([scene({ slots: [{ slot: 'step1', text: 'x' }] })]));
    expect(JSON.stringify(result)).toContain('needs a slot');
  });

  it('needs a title for a title scene, and a box for each slot of a free one', () => {
    const noTitle = SceneSpec.safeParse(
      spec([scene({ id: 't', template: 'title', slots: [{ slot: 'main', asset: 'brain' }] })]),
    );
    expect(JSON.stringify(noTitle)).toContain('needs a title');
    const noBox = SceneSpec.safeParse(
      spec([scene({ id: 'f', template: 'free', slots: [{ slot: 'a', text: 'x' }] })]),
    );
    expect(JSON.stringify(noBox)).toContain('needs a box');
  });

  it('only lets a free scene place by box', () => {
    const boxed = SceneSpec.safeParse(
      spec([
        scene({
          slots: [
            { slot: 'step1', text: 'a', box: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            { slot: 'step2', text: 'b' },
            { slot: 'step3', text: 'c' },
          ],
        }),
      ]),
    );
    expect(JSON.stringify(boxed)).toContain('only a free scene');
  });

  it('wants a drawing or words in every slot', () => {
    const result = SceneSpec.safeParse(
      spec([
        scene({
          slots: [{ slot: 'step1' }, { slot: 'step2', text: 'b' }, { slot: 'step3', text: 'c' }],
        }),
      ]),
    );
    expect(JSON.stringify(result)).toContain('a drawing (asset) or words (text)');
  });

  it('rejects repeated ids, a slot used twice, bad ids and an empty plan', () => {
    expect(SceneSpec.safeParse(spec([scene(), scene()])).success).toBe(false);
    expect(
      SceneSpec.safeParse(
        spec([
          scene({
            slots: [
              { slot: 'step1', text: 'a' },
              { slot: 'step1', text: 'b' },
            ],
          }),
        ]),
      ).success,
    ).toBe(false);
    expect(SceneSpec.safeParse(spec([scene({ id: 'Not Valid' })])).success).toBe(false);
    expect(SceneSpec.safeParse(spec([])).success).toBe(false);
    expect(
      SceneSpec.safeParse(
        spec([scene()], {
          assetNeeds: [
            { id: 'dup', label: 'a', description: 'a' },
            { id: 'dup', label: 'b', description: 'b' },
          ],
        }),
      ).success,
    ).toBe(false);
  });
});

describe('VectorAssetSet', () => {
  it('holds drawings and nothing else', () => {
    const asset = {
      id: 'mug',
      label: 'A mug',
      viewBox: { width: 100, height: 100 },
      strokes: [{ d: 'M 1 1 L 9 9' }],
      source: 'generated',
    };
    expect(VectorAssetSet.safeParse({ assets: [asset] }).success).toBe(true);
    expect(VectorAssetSet.safeParse({ assets: [{ ...asset, id: 'Bad Id' }] }).success).toBe(false);
    expect(VectorAssetSet.safeParse({ assets: [{ ...asset, strokes: [] }] }).success).toBe(false);
  });
});
