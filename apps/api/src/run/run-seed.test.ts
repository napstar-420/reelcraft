import { describe, expect, it } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import {
  describeSeedStop,
  reusableStageKeys,
  remapProvenance,
  remapTimelineHandles,
  untilStageKeep,
} from './run-seed';
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
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics', 'selector'],
      stop: { stageKey: 'script', reason: 'not_in_source' },
    });
  });

  it('reuses everything, with no stop, when nothing differs', () => {
    expect(reusableStageKeys(baseParams())).toEqual({ keys: ['topics', 'selector'] });
  });

  it('does not count a changed phase name as an edit', () => {
    const p = baseParams({ newGraph: [stage('topics'), stage('selector', { group: 'Pick' })] });
    expect(reusableStageKeys(p)).toEqual({ keys: ['topics', 'selector'] });
  });

  it('keeps an edited finished stage, and the ones after it, when the person chose to', () => {
    const p = baseParams({
      newGraph: [stage('topics'), stage('selector', { label: 'Selector v2' })],
    });
    expect(reusableStageKeys({ ...p, keepStageKeys: ['selector'] })).toEqual({
      keys: ['topics', 'selector'],
    });
    // A kept stage still needs a finished source and reused dependencies.
    expect(
      reusableStageKeys({
        ...p,
        keepStageKeys: ['selector'],
        sourceExecutions: [
          { stageKey: 'topics', state: 'failed', needsItemWork: false },
          { stageKey: 'selector', state: 'passed', needsItemWork: false },
        ],
      }),
    ).toEqual({ keys: [], stop: { stageKey: 'topics', reason: 'failed' } });
  });

  it('cuts the prefix where a middle stage was edited', () => {
    const p = baseParams({
      newGraph: [stage('topics'), stage('selector', { label: 'Selector v2' })],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'definition_changed' },
    });
  });

  it('cuts at an explicit rerun key', () => {
    const p = baseParams({ rerunStageKeys: ['topics'] });
    expect(reusableStageKeys(p)).toEqual({
      keys: [],
      stop: { stageKey: 'topics', reason: 'rerun_requested' },
    });
  });

  it('leaves the stage before a rerun key reused', () => {
    const p = baseParams({ rerunStageKeys: ['selector'] });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'rerun_requested' },
    });
  });

  it('cuts where resolved config plus overrides differ', () => {
    const p = baseParams({
      newResolvedConfig: { selector: { model: { provider: 'openrouter', modelId: 'x' } } },
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'config_changed' },
    });
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
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'assets_changed' },
    });
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['awaiting_approval', 'awaiting_approval'],
    ['awaiting_input', 'awaiting_input'],
    ['running', 'not_run'],
    ['pending', 'not_run'],
    ['skipped', 'not_run'],
    ['stale', 'not_run'],
  ] as const)('cuts at a source stage that is %s (%s)', (state, reason) => {
    const p = baseParams({
      sourceExecutions: [
        { stageKey: 'topics', state: 'passed', needsItemWork: false },
        { stageKey: 'selector', state, needsItemWork: false },
      ],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason },
    });
  });

  it('cuts at a source stage that passed but still needs item work', () => {
    const p = baseParams({
      sourceExecutions: [
        { stageKey: 'topics', state: 'passed', needsItemWork: false },
        { stageKey: 'selector', state: 'passed', needsItemWork: true },
      ],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'items_incomplete' },
    });
  });

  it('reports an item-mode approval wait (stage still running) as awaiting approval', () => {
    const p = baseParams({
      sourceExecutions: [
        { stageKey: 'topics', state: 'passed', needsItemWork: false },
        { stageKey: 'selector', state: 'running', needsItemWork: true, itemAwaitingApproval: true },
      ],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['topics'],
      stop: { stageKey: 'selector', reason: 'awaiting_approval' },
    });
  });

  it('reuses nothing when roles changed', () => {
    const p = baseParams({
      sourceRoles: [],
      newRoles: [{ key: 'host', characterId: 'char-1' } as never],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: [],
      stop: { stageKey: 'topics', reason: 'roles_changed' },
    });
  });

  it('cuts where keys were reordered', () => {
    const p = baseParams({
      newGraph: [stage('selector'), stage('topics')],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: [],
      stop: { stageKey: 'selector', reason: 'not_in_source' },
    });
  });

  it('reuses explicitly connected work moved earlier when its input sources stay the same', () => {
    const sourceGraph = [
      stage('script', { dependsOn: [] }),
      stage('narration', { dependsOn: ['script'] }),
      stage('sheets', { dependsOn: ['script'] }),
    ];
    const newGraph = [sourceGraph[0]!, sourceGraph[2]!, sourceGraph[1]!];
    const p = baseParams({
      sourceGraph,
      newGraph,
      sourceExecutions: sourceGraph.map(({ key }) => ({
        stageKey: key,
        state: 'passed',
        needsItemWork: false,
      })),
    });
    expect(reusableStageKeys(p)).toEqual({ keys: ['script', 'sheets', 'narration'] });
    const withPrev = stage('sheets', {
      dependsOn: ['script'],
      context: { input: { from: 'prev' } },
    });
    expect(
      reusableStageKeys({
        ...p,
        sourceGraph: [sourceGraph[0]!, sourceGraph[1]!, withPrev],
        newGraph: [sourceGraph[0]!, withPrev, sourceGraph[1]!],
      }),
    ).toEqual({
      keys: ['script', 'narration'],
      stop: { stageKey: 'sheets', reason: 'definition_changed' },
    });
  });

  it('ignores iterate.concurrency when comparing stage definitions', () => {
    const iterate = {
      over: { from: 'memory' as const, key: 'shots' },
      itemAlias: 'item',
      itemRetryLimit: 0,
    };
    const withConcurrency = (n: number) =>
      stage('selector', { iterate: { ...iterate, concurrency: n } as never });
    const p = baseParams({
      sourceGraph: [stage('topics'), withConcurrency(1)],
      newGraph: [stage('topics'), withConcurrency(3)],
    });
    expect(reusableStageKeys(p)).toEqual({ keys: ['topics', 'selector'] });
  });

  it('ignores stages outside `relevant`, so a changed sibling does not cut the prefix', () => {
    const sourceGraph = [stage('a'), stage('b'), stage('c', { dependsOn: ['a'] })];
    const newGraph = [stage('a'), stage('b', { label: 'B v2' }), stage('c', { dependsOn: ['a'] })];
    const p = baseParams({
      sourceGraph,
      newGraph,
      sourceExecutions: ['a', 'b', 'c'].map((stageKey) => ({
        stageKey,
        state: 'passed',
        needsItemWork: false,
      })),
    });
    expect(reusableStageKeys({ ...p, relevant: new Set(['a', 'c']) })).toEqual({
      keys: ['a', 'c'],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['a', 'c'],
      stop: { stageKey: 'b', reason: 'definition_changed' },
    });
  });

  it('keeps a finished sibling branch when another branch starts later', () => {
    const graph = [
      stage('script', { dependsOn: [] }),
      stage('visual', { dependsOn: ['script'] }),
      stage('sheets', { dependsOn: ['visual'] }),
      stage('narration', { dependsOn: ['script'] }),
      stage('audio', { dependsOn: ['narration'] }),
    ];
    const p = baseParams({
      sourceGraph: graph,
      newGraph: graph,
      sourceExecutions: graph.map(({ key }) => ({
        stageKey: key,
        state: key === 'narration' || key === 'audio' ? 'skipped' : 'passed',
        needsItemWork: false,
      })),
      rerunStageKeys: ['narration'],
      relevant: new Set(['script', 'visual', 'sheets']),
    });
    expect(reusableStageKeys(p)).toEqual({ keys: ['script', 'visual', 'sheets'] });
    expect(reusableStageKeys({ ...p, relevant: new Set(graph.map((s) => s.key)) })).toEqual({
      keys: ['script', 'visual', 'sheets'],
      stop: { stageKey: 'narration', reason: 'rerun_requested' },
    });
  });

  it('does not reuse a passed stage after its dependency is rerun', () => {
    const graph = [
      stage('script', { dependsOn: [] }),
      stage('visual', { dependsOn: ['script'] }),
      stage('narration', { dependsOn: ['script'] }),
      stage('audio', { dependsOn: ['narration'] }),
    ];
    const p = baseParams({
      sourceGraph: graph,
      newGraph: graph,
      sourceExecutions: graph.map(({ key }) => ({
        stageKey: key,
        state: 'passed',
        needsItemWork: false,
      })),
      rerunStageKeys: ['narration'],
    });
    expect(reusableStageKeys(p)).toEqual({
      keys: ['script', 'visual'],
      stop: { stageKey: 'narration', reason: 'rerun_requested' },
    });
  });

  it('ignores dependsOn when comparing stage definitions', () => {
    const p = baseParams({
      sourceGraph: [stage('topics'), stage('selector')],
      newGraph: [stage('topics'), stage('selector', { dependsOn: [] })],
    });
    expect(reusableStageKeys(p)).toEqual({ keys: ['topics', 'selector'] });
  });

  it('still cuts when another part of an iterating stage changed', () => {
    const iterate = { over: { from: 'memory' as const, key: 'shots' }, itemAlias: 'item' };
    const p = baseParams({
      sourceGraph: [
        stage('topics'),
        stage('selector', { iterate: { ...iterate, itemRetryLimit: 0 } }),
      ],
      newGraph: [
        stage('topics'),
        stage('selector', { iterate: { ...iterate, itemRetryLimit: 2 } }),
      ],
    });
    expect(reusableStageKeys(p).stop).toEqual({
      stageKey: 'selector',
      reason: 'definition_changed',
    });
  });
});

describe('describeSeedStop', () => {
  it('names the stage and the reason', () => {
    expect(describeSeedStop({ stageKey: 'A', reason: 'awaiting_approval' })).toBe(
      'Re-running "A": it was awaiting approval in the source run',
    );
    expect(describeSeedStop({ stageKey: 'A', reason: 'failed' }, 'Would re-run')).toBe(
      'Would re-run "A": it failed in the source run',
    );
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

describe('untilStageKeep', () => {
  const chain = [stage('topics'), stage('selector'), stage('script')];

  it('is undefined when unset or unknown', () => {
    expect(untilStageKeep(chain, undefined)).toBeUndefined();
    expect(untilStageKeep(chain, 'nope')).toBeUndefined();
  });

  it('keeps everything up to the stage in a chain', () => {
    expect([...untilStageKeep(chain, 'selector')!].sort()).toEqual(['selector', 'topics']);
  });

  it('keeps only the stage and what it waits for in a diamond', () => {
    const diamond = [
      stage('a'),
      stage('b', { dependsOn: ['a'] }),
      stage('c', { dependsOn: ['a'] }),
      stage('d', { dependsOn: ['b', 'c'] }),
    ];
    expect([...untilStageKeep(diamond, 'c')!].sort()).toEqual(['a', 'c']);
    expect([...untilStageKeep(diamond, 'd')!].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('remapTimelineHandles', () => {
  it('points copied timeline handles (and clip positions) at the new artifacts', () => {
    const idMap = new Map([['OLD1', 'NEW1']]);
    const data = {
      tracks: [
        {
          items: [
            { handle: 'artifact:OLD1' },
            { handle: 'artifact:OLD1#2' },
            { handle: 'asset:A' },
          ],
        },
      ],
    };
    expect(remapTimelineHandles(data, idMap)).toEqual({
      tracks: [
        {
          items: [
            { handle: 'artifact:NEW1' },
            { handle: 'artifact:NEW1#2' },
            { handle: 'asset:A' },
          ],
        },
      ],
    });
  });
});
