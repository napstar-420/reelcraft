import { describe, expect, it } from 'vitest';
import { AssetCatalog } from '@reelcraft/shared';
import { builtinCatalog } from './builtin-library';
import { libraryCatalog, type LibraryBinding } from './library-catalog';

const bindings: Record<string, LibraryBinding> = {
  a1: {
    blobId: 'b1',
    kind: 'media.audio',
    name: 'rain-loop',
    tags: ['ambient', 'weather'],
    inLibrary: true,
  },
  a2: { blobId: 'b2', kind: 'media.audio', name: 'pop', tags: ['sfx'], inLibrary: true },
  a3: { blobId: 'b3', kind: 'media.audio', name: 'bound-by-hand', inLibrary: false },
  i1: { blobId: 'b4', kind: 'media.image', name: 'logo', inLibrary: true },
  v1: {
    blobId: 'b5',
    kind: 'vector',
    name: 'My Lightbulb!',
    tags: ['idea'],
    inLibrary: true,
    vector: { viewBox: { width: 24, height: 24 }, strokes: [{ d: 'M 1 1 L 9 9', color: '#000' }] },
  },
  v2: { blobId: 'b6', kind: 'vector', name: 'broken', inLibrary: true, vector: { nope: 1 } },
};

describe('libraryCatalog', () => {
  it('lists uploaded assets of a kind by name, with their handle and length', () => {
    const catalog = libraryCatalog({
      kinds: ['audio'],
      builtin: false,
      bindings,
      durations: { a1: 42.5 },
    });
    expect(AssetCatalog.safeParse(catalog).success).toBe(true);
    expect(catalog.assets).toEqual([
      {
        id: 'pop',
        kind: 'audio',
        label: 'pop',
        tags: ['sfx'],
        handle: 'asset:a2',
        source: 'library',
      },
      {
        id: 'rain-loop',
        kind: 'audio',
        label: 'rain-loop',
        tags: ['ambient', 'weather'],
        handle: 'asset:a1',
        durationSec: 42.5,
        source: 'library',
      },
    ]);
  });

  it('leaves out an asset the run bound on its own, and other kinds', () => {
    const ids = libraryCatalog({ kinds: ['audio'], builtin: false, bindings }).assets.map(
      (a) => a.id,
    );
    expect(ids).not.toContain('bound-by-hand');
    expect(ids).not.toContain('logo');
  });

  it('keeps only assets with every tag asked for, ignoring case', () => {
    const only = libraryCatalog({
      kinds: ['audio'],
      builtin: false,
      tags: ['WEATHER', 'ambient'],
      bindings,
    });
    expect(only.assets.map((a) => a.id)).toEqual(['rain-loop']);
  });

  it('adds the built-in assets after the uploaded ones, unless asked not to', () => {
    const withBuiltin = libraryCatalog({ kinds: ['audio'], bindings });
    const ids = withBuiltin.assets.map((a) => a.id);
    expect(ids.slice(0, 2)).toEqual(['pop', 'rain-loop']);
    expect(ids).toContain('whoosh');
    // An uploaded asset takes the place of a built-in one with the same name.
    expect(ids.filter((id) => id === 'pop')).toHaveLength(1);
    expect(withBuiltin.assets.find((a) => a.id === 'whoosh')).toMatchObject({
      handle: 'builtin:audio/whoosh',
      source: 'builtin',
    });
  });

  it('turns an uploaded drawing into a vector asset, and skips one that was not readable', () => {
    const { assets } = libraryCatalog({ kinds: ['vector'], builtin: false, bindings });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: 'My Lightbulb!',
      kind: 'vector',
      source: 'library',
      vector: { id: 'my-lightbulb', viewBox: { width: 24, height: 24 }, source: 'library' },
    });
  });

  it('lists the built-in drawings, with tags, and nothing built in for pictures or clips', () => {
    const drawings = builtinCatalog('vector');
    expect(drawings.length).toBeGreaterThan(50);
    expect(drawings.find((a) => a.id === 'lightbulb')).toMatchObject({
      kind: 'vector',
      source: 'builtin',
    });
    expect(AssetCatalog.safeParse({ assets: drawings }).success).toBe(true);
    expect(builtinCatalog('image')).toEqual([]);
    expect(builtinCatalog('video')).toEqual([]);
  });

  it('is the same for the same snapshot', () => {
    expect(JSON.stringify(libraryCatalog({ kinds: ['audio'], bindings }))).toBe(
      JSON.stringify(libraryCatalog({ kinds: ['audio'], bindings })),
    );
  });
});
