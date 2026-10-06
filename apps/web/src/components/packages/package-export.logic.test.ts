import { describe, expect, it } from 'vitest';
import type { PackageReferenceDto } from '@reelcraft/shared';
import { choiceFor, formatBytes, slotOnlyReason } from './package-export.logic';

const ref = (over: Partial<PackageReferenceDto> = {}): PackageReferenceDto => ({
  id: 'r',
  kind: 'asset',
  name: 'Logo',
  bytes: 10,
  missing: false,
  tooLarge: false,
  ...over,
});

describe('package export choices', () => {
  it('bundles by default and honours a pick', () => {
    expect(choiceFor(ref(), {})).toBe('bundle');
    expect(choiceFor(ref(), { r: 'slot' })).toBe('slot');
  });

  it('forces a slot for a missing or oversized reference', () => {
    expect(choiceFor(ref({ missing: true }), { r: 'bundle' })).toBe('slot');
    expect(choiceFor(ref({ tooLarge: true }), {})).toBe('slot');
    expect(slotOnlyReason(ref({ missing: true }))).toMatch(/No longer available/);
    expect(slotOnlyReason(ref())).toBeNull();
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
