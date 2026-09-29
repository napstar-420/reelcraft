import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { reusableStageKeys, remapProvenance, untilStageIndex } from './run-seed';
import type { RefProvenance } from '../artifact/binding-resolver.service';

function stage(key: string, overrides: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...overrides,
  } as StageDef;
}

function baseParams(overrides: Partial<Parameters<typeof reusableStageKeys>[0]> = {}) {
  const graph = [stage('topics'), stage('selector')];
  return {
    sourceGraph: graph,
    newGraph: graph,
    sourceResolvedConfig: {},
    sourceOverrides: {},
    newResolvedConfig: {},
    sourceAssetBindings: {},
    newAssetBindings: {},
    sourceRoles: [],
    newRoles: [],
    sourceExecutions: [
      { stageKey: 'topics', state: 'passed', needsItemWork: false },
      { stageKey: 'selector', state: 'passed', needsItemWork: false },
    ],
    rerunStageKeys: [],
    ...overrides,
  };
}

describe('reusableStageKeys', () => {
  it('reuses the whole prefix when an unchanged graph gains an appended stage', () => {
    const p = baseParams({
      newGraph: [stage('topics'), stage('selector'), stage('script')],
    });
    expect(reusableStageKeys(p)).toEqual(['topics', 'selector']);
  });

  it('cuts the prefix where a middle stage was edited', () => {
    const p = baseParams({
      newGraph: [stage('topics'), stage('selector', { label: 'Selector v2' })],
    });
    expect(reusableStageKeys(p)).toEqual(['topics']);
  });

  it('cuts at an explicit rerun key', () => {
    const p = baseParams({ rerunStageKeys: ['topics'] });
    expect(reusableStageKeys(p)).toEqual([]);
  });

  it('cuts where resolved config plus overrides differ', () => {
    const p = baseParams({
      newResolvedConfig: { selector: { model: { provider: 'openrouter', modelId: 'x' } } },
    });
    expect(reusableStageKeys(p)).toEqual(['topics']);
  });

  it('cuts where asset bindings differ', () => {
    const graph = [
      stage('topics'),
      stage('selector', {
        slots: { logo: { from: 'asset', assetId: 'asset-1' } },
      }),
    ];
    const p = baseParams({
      sourceGraph: graph,
      newGraph: graph,
      sourceAssetBindings: { 'asset-1': { blobId: 'blob-a', kind: 'image' } },
      newAssetBindings: { 'asset-1': { blobId: 'blob-b', kind: 'image' } },
    });
    expect(reusableStageKeys(p)).toEqual(['topics']);
  });

  it('cuts at a source stage that is not passed', () => {
    const p = baseParams({
      sourceExecutions: [
        { stageKey: 'topics', state: 'passed', needsItemWork: false },
        { stageKey: 'selector', state: 'failed', needsItemWork: false },
      ],
    });
    expect(reusableStageKeys(p)).toEqual(['topics']);
  });

  it('cuts at a source stage that still needs item work', () => {
    const p = baseParams({
      sourceExecutions: [
        { stageKey: 'topics', state: 'passed', needsItemWork: false },
        { stageKey: 'selector', state: 'passed', needsItemWork: true },
      ],
    });
    expect(reusableStageKeys(p)).toEqual(['topics']);
  });

  it('reuses nothing when roles changed', () => {
    const p = baseParams({
      sourceRoles: [],
      newRoles: [{ key: 'host', characterId: 'char-1' } as never],
    });
    expect(reusableStageKeys(p)).toEqual([]);
  });

  it('cuts where keys were reordered', () => {
    const p = baseParams({
      newGraph: [stage('selector'), stage('topics')],
    });
    expect(reusableStageKeys(p)).toEqual([]);
  });
});

describe('remapProvenance', () => {
  it('remaps artifactId and artifactIds through the id map, leaving other provenance untouched', () => {
    const idMap = new Map([
      ['old-1', 'new-1'],
      ['old-2', 'new-2'],
    ]);
    const provenance: Record<string, RefProvenance> = {
      slotA: { ref: { from: 'prev' } as never, artifactId: 'old-1' },
      slotB: { ref: { from: 'prevItem' } as never, artifactIds: ['old-1', 'old-2'] },
      slotC: { ref: { from: 'memory' } as never, memoryKey: 'keyframe', memoryVersion: 3 },
      slotD: { ref: { from: 'prev' } as never, artifactId: 'unmapped' },
    };
    expect(remapProvenance(provenance, idMap)).toEqual({
      slotA: { ref: { from: 'prev' }, artifactId: 'new-1' },
      slotB: { ref: { from: 'prevItem' }, artifactIds: ['new-1', 'new-2'] },
      slotC: { ref: { from: 'memory' }, memoryKey: 'keyframe', memoryVersion: 3 },
      slotD: { ref: { from: 'prev' }, artifactId: 'unmapped' },
    });
  });
});

describe('untilStageIndex', () => {
  const graph = [stage('topics'), stage('selector'), stage('script')];

  it('is undefined when unset', () => {
    expect(untilStageIndex(graph, undefined)).toBeUndefined();
  });

  it('finds the matching stage index', () => {
    expect(untilStageIndex(graph, 'selector')).toBe(1);
  });

  it('is undefined for an unknown key', () => {
    expect(untilStageIndex(graph, 'nope')).toBeUndefined();
  });
});
