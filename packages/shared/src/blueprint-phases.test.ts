import { describe, expect, it } from 'vitest';
import { blueprintPhases } from './blueprint-phases';

describe('blueprintPhases', () => {
  it('lists each stage group once, in order', () => {
    expect(
      blueprintPhases([
        { key: 'a', label: 'A', group: 'Script' },
        { key: 'b', label: 'B', group: ' Voice ' },
        { key: 'c', label: 'C', group: 'Script' },
        { key: 'd', label: 'D' },
        { key: 'e', label: 'E', group: 'Visuals' },
      ]),
    ).toEqual(['Script', 'Voice', 'Visuals']);
  });

  it('caps the groups at five', () => {
    const graph = Array.from({ length: 7 }, (_, i) => ({
      key: `s${i}`,
      label: '',
      group: `G${i}`,
    }));
    expect(blueprintPhases(graph)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4']);
  });

  it('falls back to the first five labels without a leading number, or the key', () => {
    expect(
      blueprintPhases([
        { key: 'script', label: '1 · Script' },
        { key: 'voice', label: '' },
        { key: 'c', label: '11. Captions' },
        { key: 'd', label: 'Music' },
        { key: 'e', label: '2) Mix' },
        { key: 'f', label: 'Render' },
      ]),
    ).toEqual(['Script', 'voice', 'Captions', 'Music', 'Mix']);
  });

  it('is empty for an empty graph', () => {
    expect(blueprintPhases([])).toEqual([]);
  });
});
