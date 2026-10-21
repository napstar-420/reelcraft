import { describe, expect, it } from 'vitest';
import { JsonSchema } from './json-schema';
import { MotionSource, motionAnswerJsonSchema, motionSourceJsonSchema } from './motion-source';

const source = {
  version: 1,
  code: 'export default () => null;',
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 4,
  background: 'transparent',
};

describe('MotionSource', () => {
  it('accepts a graphic and refuses one outside the limits', () => {
    expect(MotionSource.safeParse(source).success).toBe(true);
    expect(MotionSource.safeParse({ ...source, durationSec: 0.5 }).success).toBe(false);
    expect(MotionSource.safeParse({ ...source, width: 8000 }).success).toBe(false);
    expect(
      MotionSource.safeParse({ ...source, assets: [{ name: '../x.png', handle: 'a' }] }).success,
    ).toBe(false);
  });

  it('describes itself in the restricted schema dialect', () => {
    expect(JsonSchema.safeParse(motionSourceJsonSchema).success).toBe(true);
    expect(JsonSchema.safeParse(motionAnswerJsonSchema).success).toBe(true);
    expect(motionSourceJsonSchema.required).toEqual(
      Object.keys(MotionSource.shape).filter(
        (key) => !MotionSource.shape[key as keyof typeof MotionSource.shape].isOptional(),
      ),
    );
  });
});
