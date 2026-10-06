import { describe, expect, it } from 'vitest';
import { formatFingerprint } from './format-fingerprint';

describe('formatFingerprint', () => {
  it('groups a fingerprint in fours', () => {
    expect(formatFingerprint('ab12cd34ef56ab78')).toBe('ab12 cd34 ef56 ab78');
  });
});
