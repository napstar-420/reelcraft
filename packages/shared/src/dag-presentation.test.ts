import { describe, it, expect } from 'vitest';
import { BlueprintPresentation, CreateBlueprintVersionDto } from './dto/blueprint.dto';
import { PackagePipeline } from './dto/package.dto';
import { stageFreshness } from './stage-freshness';
import { disabledAncestor } from './stage-deps';
const source = CreateBlueprintVersionDto.parse({
  graph: [
    {
      key: 'a',
      label: 'A',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
    },
    {
      key: 'b',
      label: 'B',
      capability: 'text.generate',
      config: {},
      slots: {},
      context: {},
      output: { kind: 'text' },
      checks: [],
    },
  ],
  budget: { runCapUsd: 10 },
});
describe('presentation and availability', () => {
  it('round trips positions and named branches through package content', () => {
    const presentation = { positions: { a: { x: 10, y: -20 } }, branchNames: { a: 'Narration' } };
    expect(PackagePipeline.parse({ ...source, presentation }).presentation).toEqual(presentation);
    expect(
      BlueprintPresentation.safeParse({ positions: { a: { x: Infinity, y: 0 } } }).success,
    ).toBe(false);
  });
  it('does not stale outputs for layout, names or availability edits', () => {
    const next = {
      ...source,
      presentation: { positions: { a: { x: 90, y: 20 } }, branchNames: { a: 'New name' } },
      graph: source.graph.map((s) => ({ ...s, disabled: s.key === 'a' })),
    };
    expect(stageFreshness(source, next).staleStageKeys).toEqual([]);
    expect(disabledAncestor(next.graph, 'b')?.key).toBe('a');
    expect(disabledAncestor(next.graph, 'a')).toBeUndefined();
  });
});
