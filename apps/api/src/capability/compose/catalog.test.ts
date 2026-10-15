import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';

const vector = {
  id: 'mug',
  label: 'A mug',
  viewBox: { width: 100, height: 100 },
  strokes: [{ d: 'M0 0 L10 10' }],
  source: 'generated',
};
const general = (...values: unknown[]) => values.map((value) => ({ slot: 'assets', value }));

describe('buildCatalog', () => {
  it('names files in the general slot by their place among files of their kind, and reads their length', () => {
    const { assets, problems } = buildCatalog(
      general(
        [
          { handle: 'artifact:a#0', kind: 'media.image' },
          { handle: 'artifact:a#1', kind: 'media.image' },
        ],
        { handle: 'artifact:v', kind: 'media.audio', probe: { durationSec: 7.5 } },
        { handle: 'artifact:c', kind: 'media.video', durationSec: 3 },
      ),
    );
    expect(problems).toEqual([]);
    expect(assets.values().map((a) => a.id)).toEqual(['image-1', 'image-2', 'audio-1', 'video-1']);
    expect(assets.get('audio', 'audio-1')).toMatchObject({ kind: 'audio', durationSec: 7.5 });
    expect(assets.get('video', 'video-1')!.durationSec).toBe(3);
  });

  it('names a file after its slot, and several files after the slot and their place', () => {
    const { assets } = buildCatalog([
      { slot: 'voice', value: { handle: 'artifact:v', kind: 'media.audio' } },
      {
        slot: 'photos',
        value: [
          { handle: 'artifact:p#0', kind: 'media.image' },
          { handle: 'artifact:p#1', kind: 'media.image' },
        ],
      },
    ]);
    expect(assets.values().map((a) => a.id)).toEqual(['voice', 'photos-1', 'photos-2']);
  });

  it('uses the name of a library file, and says where it came from', () => {
    const { assets } = buildCatalog(
      general(
        { handle: 'asset:01H', kind: 'media.audio', name: 'whoosh-1' },
        { handle: 'builtin:audio/pop', kind: 'media.audio', name: 'pop' },
      ),
    );
    expect(assets.get('audio', 'whoosh-1')).toMatchObject({
      source: 'library',
      handle: 'asset:01H',
    });
    expect(assets.get('audio', 'pop')!.source).toBe('builtin');
  });

  it('reads a catalogue and a set of drawings', () => {
    const { assets, problems } = buildCatalog(
      general(
        { assets: [{ id: 'rain', kind: 'audio', handle: 'asset:1', tags: ['weather'] }] },
        { assets: [vector] },
      ),
    );
    expect(problems).toEqual([]);
    expect(assets.get('audio', 'rain')!.tags).toEqual(['weather']);
    expect(assets.get('vector', 'mug')).toMatchObject({ kind: 'vector', source: 'generated' });
  });

  it('lets a drawing and a sound share an id, since the kind of layer says which is meant', () => {
    const { assets, problems } = buildCatalog(
      general(
        { assets: [{ id: 'pop', kind: 'audio', handle: 'builtin:audio/pop' }] },
        { assets: [{ id: 'pop', kind: 'vector', vector }] },
      ),
    );
    expect(problems).toEqual([]);
    expect(assets.get('audio', 'pop')).toBeDefined();
    expect(assets.get('vector', 'pop')).toBeDefined();
    expect(assets.size).toBe(2);
  });

  it('reports a repeated id and something that is not an asset', () => {
    const { problems } = buildCatalog(
      general({ assets: [vector] }, { assets: [vector] }, { nope: 1 }),
    );
    expect(problems.join(' ')).toContain('two vector assets are called "mug"');
    expect(problems.join(' ')).toContain('not an asset');
  });
});
