import { describe, expect, it } from 'vitest';
import { collectFileInputs, isFileKind, modelAcceptsKind } from './file-inputs';

describe('collectFileInputs', () => {
  const context = {
    brief: 'Write a caption',
    scene: { title: 'Intro', beats: [1, 2] },
    shoe: { handle: 'asset:a1', kind: 'media.image', sourceKey: 'assets/shoe.png' },
    hero: [
      { handle: 'character:c1:b1', kind: 'media.image', sourceKey: 'chars/1.png' },
      { handle: 'character:c1:b2', kind: 'media.image', sourceKey: 'chars/2.png' },
    ],
    doc: { handle: 'artifact:x', kind: 'file.pdf', sourceKey: 'runs/doc.pdf' },
    clips: [{ handle: 'artifact:v1', kind: 'media.video', sourceKey: 'runs/v1.mp4' }],
  };

  it('names files by binding, numbers multi-file bindings, and skips inline values', () => {
    const files = collectFileInputs(context, ['brief', 'scene', 'shoe', 'hero', 'doc']);
    expect(files).toEqual([
      { name: 'shoe', kind: 'media.image', sourceKey: 'assets/shoe.png', handle: 'asset:a1' },
      { name: 'hero[1]', kind: 'media.image', sourceKey: 'chars/1.png', handle: 'character:c1:b1' },
      { name: 'hero[2]', kind: 'media.image', sourceKey: 'chars/2.png', handle: 'character:c1:b2' },
      { name: 'doc', kind: 'file.pdf', sourceKey: 'runs/doc.pdf', handle: 'artifact:x' },
    ]);
  });

  it('only reads the attached keys, in attach order', () => {
    expect(collectFileInputs(context, ['doc', 'shoe']).map((f) => f.name)).toEqual(['doc', 'shoe']);
    expect(collectFileInputs(context, [])).toEqual([]);
  });

  it('dedupes a file bound twice, keeping the first binding', () => {
    const shoe = { kind: 'media.image', sourceKey: 'assets/shoe.png' };
    expect(collectFileInputs({ a: shoe, b: shoe }, ['a', 'b']).map((f) => f.name)).toEqual(['a']);
  });
});

describe('isFileKind / modelAcceptsKind', () => {
  it('treats every non-inline kind, including future ones, as a file', () => {
    expect(['media.image', 'media.audio', 'file.pdf', 'font'].every(isFileKind)).toBe(true);
    expect(['text', 'data', 'timeline', 'literal', 'unknown'].some(isFileKind)).toBe(false);
  });

  it('matches exact kinds and prefix wildcards', () => {
    expect(modelAcceptsKind(['media.image'], 'media.image')).toBe(true);
    expect(modelAcceptsKind(['media.image'], 'media.video')).toBe(false);
    expect(modelAcceptsKind(['file.*'], 'file.pdf')).toBe(true);
    expect(modelAcceptsKind([], 'media.image')).toBe(false);
  });
});
