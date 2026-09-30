import { describe, expect, it } from 'vitest';
import type { ReferenceImage } from '@reelcraft/shared';
import { normalizeRoleReferences } from './role-references';

const ref = (blobId: string, order: number): ReferenceImage => ({
  blobId,
  view: 'front',
  origin: 'uploaded',
  order,
});
const referenceSet = [ref('b', 1), ref('a', 0), ref('c', 2)];

describe('normalizeRoleReferences', () => {
  it('keeps a valid selection and drops ids the Character no longer has', () => {
    expect(
      normalizeRoleReferences(['c', 'gone', 'a'], { referenceSet, primaryRefId: 'b' }),
    ).toEqual(['c', 'a']);
  });

  it('defaults an empty selection to the primary, else the first by order', () => {
    expect(normalizeRoleReferences([], { referenceSet, primaryRefId: 'c' })).toEqual(['c']);
    expect(normalizeRoleReferences(['gone'], { referenceSet, primaryRefId: null })).toEqual(['a']);
    expect(normalizeRoleReferences([], { referenceSet: [], primaryRefId: null })).toEqual([]);
  });
});
