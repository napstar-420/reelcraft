import { describe, expect, it } from 'vitest';
import type { MotionSource } from '@reelcraft/shared';
import { editedSource, hasChanges, motionSourceOf } from './motion-code-editor.logic';

const source: MotionSource = {
  version: 1,
  code: 'export default () => null;',
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 4,
  background: 'transparent',
};

describe('motion code editor logic', () => {
  it('reads a motion graphic and ignores other data', () => {
    expect(motionSourceOf(source)).toBe(source);
    expect(motionSourceOf({ ...source, version: 2 })).toBeUndefined();
    expect(motionSourceOf({ code: 'x' })).toBeUndefined();
    expect(motionSourceOf('text')).toBeUndefined();
  });

  it('keeps the length inside what a render allows', () => {
    expect(editedSource(source, 'new', 90).durationSec).toBe(60);
    expect(editedSource(source, 'new', 0).durationSec).toBe(1);
    expect(editedSource(source, 'new', Number.NaN).durationSec).toBe(4);
    expect(editedSource(source, 'new', 5)).toEqual({ ...source, code: 'new', durationSec: 5 });
  });

  it('knows when there is something to save', () => {
    expect(hasChanges(source, editedSource(source, source.code, 4))).toBe(false);
    expect(hasChanges(source, editedSource(source, source.code, 5))).toBe(true);
    expect(hasChanges(source, editedSource(source, 'x', 4))).toBe(true);
  });
});
