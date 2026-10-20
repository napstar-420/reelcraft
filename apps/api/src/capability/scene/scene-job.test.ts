import { describe, expect, it } from 'vitest';
import { SceneSource } from '@reelcraft/shared';
import { framesKey, sceneHandles, sceneRenderSpec } from './scene-job';

const source = SceneSource.parse({
  engine: 'blender',
  contractVersion: 1,
  script: 'def build(rc):\n    pass\n',
  assets: [
    { name: 'hero', kind: 'model', handle: 'asset:01HERO' },
    { name: 'voice', kind: 'audio', handle: 'artifact:01VOICE' },
  ],
  data: { timing: { words: [] } },
  width: 1080,
  height: 1920,
  fps: 30,
  durationSec: 2,
});

const resources = {
  'asset:01HERO': { sourceKey: 'me/ch/assets/blob.glb' },
  'artifact:01VOICE': { sourceKey: 'me/ch/run/media/a.mp3' },
};

const spec = (overrides: Partial<Parameters<typeof sceneRenderSpec>[0]> = {}) =>
  sceneRenderSpec({
    source,
    mode: 'video',
    modelFormat: 'glb',
    quality: 'final',
    renderEngine: 'auto',
    resources,
    blender: '/opt/blender/blender',
    framesDir: '/w/jobs/frames-abc',
    maxWaitSec: 600,
    env: { PATH: '/bin' },
    ...overrides,
  });

describe('sceneRenderSpec', () => {
  it('runs Blender headless, without auto-run scripts, on the wrapper and the job file', () => {
    const job = spec();
    expect(job.command).toBe('/opt/blender/blender');
    expect(job.args.slice(0, 5)).toEqual([
      '-b',
      '--factory-startup',
      '--disable-autoexec',
      '--python-exit-code',
      '1',
    ]);
    expect(job.args.slice(-3)).toEqual(['--', '{input:job.json}', '{output}']);
    expect(job.args).toContain('--python');
    expect(job.env).toEqual({ PATH: '/bin' });
    expect(job.outputFilename).toBe('scene.mp4');
  });

  it('copies each asset in under a plain name and tells the script where it is', () => {
    const job = spec();
    expect(job.inputs).toEqual([
      { sourceKey: 'me/ch/assets/blob.glb', asFilename: 'asset-0.glb' },
      { sourceKey: 'me/ch/run/media/a.mp3', asFilename: 'asset-1.mp3' },
    ]);
    const written = JSON.parse(job.files!.find((f) => f.asFilename === 'job.json')!.contents);
    expect(written).toMatchObject({
      mode: 'video',
      script: 'scene.py',
      framesDir: '/w/jobs/frames-abc',
      assets: {
        hero: { kind: 'model', path: 'asset-0.glb' },
        voice: { kind: 'audio', path: 'asset-1.mp3' },
      },
      data: { timing: { words: [] } },
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(job.files!.find((f) => f.asFilename === 'scene.py')!.contents).toBe(source.script);
  });

  it('writes a transparent clip as WebM and a model in the format asked for', () => {
    expect(spec({ source: { ...source, transparent: true } }).outputFilename).toBe('scene.webm');
    expect(spec({ mode: 'model', modelFormat: 'blend' }).outputFilename).toBe('model.blend');
  });

  it('names an asset that is gone', () => {
    expect(() => spec({ resources: {} })).toThrow('Scene asset "hero" (asset:01HERO)');
  });
});

describe('framesKey', () => {
  it('is the same for the same render and differs when anything about it changes', () => {
    expect(framesKey(source, 'final', 'auto')).toBe(framesKey(source, 'final', 'auto'));
    expect(framesKey(source, 'draft', 'auto')).not.toBe(framesKey(source, 'final', 'auto'));
    expect(framesKey({ ...source, script: 'x' }, 'final', 'auto')).not.toBe(
      framesKey(source, 'final', 'auto'),
    );
  });

  it('lists the handles the runner resolves', () => {
    expect(sceneHandles(source)).toEqual(['asset:01HERO', 'artifact:01VOICE']);
  });
});
