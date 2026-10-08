import { describe, expect, it } from 'vitest';
import { exampleScenesToImages, exampleScript } from '../guide';
import { diffDrafts, isEmptyDiff, sameDraft } from './draft-diff';
import { memoryFlow } from './memory-flow';

describe('diffDrafts', () => {
  it('is empty for equal drafts, whatever the key order', () => {
    const a = exampleScript();
    const b = structuredClone(a);
    b.graph = a.graph.map((s) => Object.fromEntries(Object.entries(s).reverse()) as typeof s);
    expect(isEmptyDiff(diffDrafts(a, b))).toBe(true);
    expect(sameDraft(a, exampleScenesToImages())).toBe(false);
  });

  it('reports added, removed and changed stages, reordering and the other parts', () => {
    const a = exampleScenesToImages();
    const b = exampleScenesToImages();
    b.graph.reverse();
    b.graph[0]!.label = 'New label';
    b.graph.push({ ...exampleScript().graph[0]! });
    b.budget = { runCapUsd: 99 };
    const diff = diffDrafts(a, b);
    expect(diff.stages).toEqual([
      { key: 'images', label: 'New label', kind: 'changed', fields: ['label'] },
      { key: 'script', label: 'Write script', kind: 'added', fields: [] },
    ]);
    expect(diff).toMatchObject({ reordered: true, budget: true, inputs: false });
  });
});

describe('memoryFlow', () => {
  it('lists writers and readers per key, including through a coalesce and iterate.over', () => {
    const graph = exampleScenesToImages().graph;
    expect(memoryFlow(graph)).toEqual([{ key: 'scenes', writtenBy: ['plan'], readBy: ['images'] }]);
    graph[1]!.slots = {
      x: {
        from: 'coalesce',
        refs: [
          { from: 'memory', key: 'other' },
          { from: 'const', value: 1 },
        ],
      },
    };
    expect(memoryFlow(graph)).toEqual(
      expect.arrayContaining([{ key: 'other', writtenBy: [], readBy: ['images'] }]),
    );
  });
});
