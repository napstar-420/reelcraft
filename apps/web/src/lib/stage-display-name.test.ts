import { describe, expect, it } from 'vitest';
import { stageDisplayName } from './stage-display-name';

describe('stageDisplayName', () => {
  it('drops a leading number in any of the usual styles', () => {
    for (const label of ['11 · Captions', '11. Captions', '11) Captions', '11 - Captions'])
      expect(stageDisplayName({ label, key: 'c' })).toBe('Captions');
  });

  it('keeps numbers that are part of the name', () => {
    expect(stageDisplayName({ label: '3D render', key: 'r' })).toBe('3D render');
  });

  it('falls back to the key', () => {
    expect(stageDisplayName({ label: '', key: 'captions' })).toBe('captions');
  });
});
