import { describe, expect, it } from 'vitest';
import { stageFreshness } from './stage-freshness';
import { StageDef } from './stage-def';
import type { CreateBlueprintVersionDto } from './dto/blueprint.dto';
const stage = (key: string, dependsOn: string[]) =>
  StageDef.parse({
    key,
    label: key,
    dependsOn,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
  });
const source: CreateBlueprintVersionDto = {
  graph: [
    stage('script', []),
    stage('images', ['script']),
    stage('voice', ['script']),
    stage('join', ['images', 'voice']),
  ],
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 10 },
};
describe('workspace output freshness', () => {
  it('marks execution edits and descendants, keeps independent branches, and restores freshness on revert', () => {
    const edited = {
      ...source,
      graph: source.graph.map((s) =>
        s.key === 'voice' ? { ...s, instructions: { template: 'New narration' } } : s,
      ),
    };
    expect(stageFreshness(source, edited)).toEqual({
      changedStageKeys: ['voice'],
      validationStageKeys: [],
      staleStageKeys: ['voice', 'join'],
    });
    expect(stageFreshness(source, source).staleStageKeys).toEqual([]);
  });
  it('ignores labels and object key order, and identifies validation-only changes separately', () => {
    const draft = {
      ...source,
      graph: source.graph.map((s) => ({
        ...s,
        label: 'Renamed',
        checks: [{ type: 'script' as const, name: 'Revalidation', code: 'return true;' }],
      })),
    };
    expect(
      stageFreshness(source, {
        ...source,
        graph: source.graph.map((s) => ({ ...s, label: 'Renamed' })),
      }).staleStageKeys,
    ).toEqual([]);
    expect(stageFreshness(source, draft).validationStageKeys).toEqual([
      'script',
      'images',
      'voice',
      'join',
    ]);
    expect(stageFreshness(source, draft).staleStageKeys).toEqual([]);
  });
  it('invalidates shared-input changes and removed dependencies without erasing history', () => {
    expect(
      stageFreshness(source, { ...source, defaults: { retryLimit: 1 } }).staleStageKeys,
    ).toEqual(['script', 'images', 'voice', 'join']);
    expect(
      stageFreshness(source, { ...source, graph: source.graph.filter((s) => s.key !== 'images') })
        .staleStageKeys,
    ).toEqual(['images', 'join']);
    expect(source.graph).toHaveLength(4);
  });
});
