import { describe, expect, it } from 'vitest';
import { blueprintFlow } from './blueprint-flow';

describe('blueprintFlow', () => {
  it('lists each phase once, in order', () => {
    expect(
      blueprintFlow([
        { key: 'a', label: 'A', group: 'Script' },
        { key: 'b', label: 'B', group: 'Script' },
        { key: 'c', label: 'C', group: 'Voice' },
      ]),
    ).toEqual(['Script', 'Voice']);
  });

  it('falls back to stage names without their numbers', () => {
    expect(
      blueprintFlow([
        { key: 'a', label: '1 · Write script' },
        { key: 'b', label: '' },
      ]),
    ).toEqual(['Write script', 'b']);
  });

  it('caps the list', () => {
    const graph = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, label: `S${i}` }));
    expect(blueprintFlow(graph, 3)).toHaveLength(3);
  });
});
