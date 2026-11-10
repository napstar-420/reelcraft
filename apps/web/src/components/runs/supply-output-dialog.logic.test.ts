import { describe, expect, it } from 'vitest';
import { supplyInputKind, supplyWarnings } from './supply-output-dialog.logic';

describe('supplyInputKind', () => {
  it('maps each output to the input it takes', () => {
    expect(supplyInputKind({ kind: 'text' })).toEqual({ type: 'text' });
    expect(supplyInputKind({ kind: 'data', schema: { type: 'object' } })).toEqual({
      type: 'data',
    });
    expect(supplyInputKind({ kind: 'timeline' })).toEqual({ type: 'timeline' });
    expect(supplyInputKind({ kind: 'media.image_list' })).toEqual({
      type: 'files',
      assetKind: 'media.image',
      many: true,
    });
    expect(supplyInputKind({ kind: 'media.model' })).toEqual({
      type: 'files',
      assetKind: 'model',
      many: false,
    });
  });
  it('has no input for subtitles or an unknown output', () => {
    expect(supplyInputKind({ kind: 'file.subtitles' })).toBeNull();
    expect(supplyInputKind(null)).toBeNull();
  });
});

describe('supplyWarnings', () => {
  it('only warns about what applies', () => {
    expect(supplyWarnings({ iterating: false, skipValidation: false })).toEqual([]);
    expect(supplyWarnings({ iterating: true, skipValidation: true })).toHaveLength(2);
  });
});
