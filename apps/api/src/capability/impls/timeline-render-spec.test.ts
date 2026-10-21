import { describe, expect, it } from 'vitest';
import { Timeline } from '@reelcraft/shared';
import { timelineRenderSpec } from './assembly.capability';

const motion = (files: Array<{ name: string; handle: string }>) => ({
  type: 'motion',
  startSec: 0,
  durationSec: 2,
  width: 640,
  height: 360,
  code: 'export default () => null;',
  files,
});

const timeline = (items: unknown[], extra: Record<string, unknown> = {}) =>
  Timeline.parse({
    version: 2,
    canvas: { width: 1920, height: 1080, fps: 30 },
    tracks: [{ id: 'overlay', type: 'overlay', items }],
    ...extra,
  });

const spec = (t: Timeline, resources: Record<string, { sourceKey: string; kind: string }>) =>
  timelineRenderSpec({
    timeline: t,
    resources: Object.fromEntries(
      Object.entries(resources).map(([handle, r]) => [handle, { handle, ...r }]),
    ),
    styles: {},
    quality: 'draft',
    maxWaitSec: 10,
  });

describe('timelineRenderSpec', () => {
  it('copies a motion graphic’s files in under the names its code loads', () => {
    const result = spec(timeline([motion([{ name: 'logo.png', handle: 'artifact:a' }])]), {
      'artifact:a': { sourceKey: 'media/a.png', kind: 'media.image' },
    });
    expect(result.inputs).toContainEqual({ sourceKey: 'media/a.png', asFilename: 'logo.png' });
  });

  it('refuses two motion graphics that load different files under one name, and a missing file', () => {
    const two = timeline([
      motion([{ name: 'logo.png', handle: 'artifact:a' }]),
      motion([{ name: 'logo.png', handle: 'artifact:b' }]),
    ]);
    expect(() =>
      spec(two, {
        'artifact:a': { sourceKey: 'media/a.png', kind: 'media.image' },
        'artifact:b': { sourceKey: 'media/b.png', kind: 'media.image' },
      }),
    ).toThrow(/two motion graphics load different files named logo\.png/);
    expect(() => spec(timeline([motion([{ name: 'x.png', handle: 'artifact:x' }])]), {})).toThrow(
      /x\.png/,
    );
  });

  it('copies fonts in, and refuses a timeline whose font is missing', () => {
    const withFont = timeline([], { fonts: [{ family: 'Brand Sans', handle: 'asset:f' }] });
    const result = spec(withFont, { 'asset:f': { sourceKey: 'assets/brand.woff2', kind: 'font' } });
    expect(result.inputs).toEqual([
      { sourceKey: 'assets/brand.woff2', asFilename: 'resource-0.woff2' },
    ]);
    expect(() => spec(withFont, {})).toThrow(/Brand Sans/);
  });
});
