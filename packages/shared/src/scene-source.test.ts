import { describe, expect, it } from 'vitest';
import { SCENE_CONTRACT_VERSION, SceneSource } from './scene-source';

const base = {
  engine: 'blender',
  contractVersion: SCENE_CONTRACT_VERSION,
  script: 'def build(rc):\n    pass\n',
  assets: [{ name: 'hero', kind: 'model', handle: 'asset:01H' }],
  width: 1920,
  height: 1080,
  fps: 24,
  durationSec: 4,
};

describe('SceneSource', () => {
  it('accepts a scene and defaults to an opaque background', () => {
    expect(SceneSource.parse(base).transparent).toBe(false);
  });

  it('refuses asset names a script could not use as a plain key', () => {
    const bad = { ...base, assets: [{ name: '../hero', kind: 'model', handle: 'asset:01H' }] };
    expect(SceneSource.safeParse(bad).success).toBe(false);
  });

  it('refuses an engine or contract it does not know', () => {
    expect(SceneSource.safeParse({ ...base, engine: 'maya' }).success).toBe(false);
    expect(SceneSource.safeParse({ ...base, contractVersion: 99 }).success).toBe(false);
  });
});
