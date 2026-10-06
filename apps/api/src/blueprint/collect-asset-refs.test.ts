import { describe, expect, it } from 'vitest';
import type { Ref, StageDef } from '@reelcraft/shared';
import { collectAssetIds, mapGraphRefs } from './collect-asset-refs';

const asset = (assetId: string): Ref => ({ from: 'asset', assetId });

function stage(patch: Partial<StageDef>): StageDef {
  return {
    key: 's',
    label: 'S',
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...patch,
  };
}

describe('collectAssetIds', () => {
  it('finds assets in slots, context, check refs, iterate.over and coalesce branches', () => {
    const graph = [
      stage({
        slots: { a: asset('slot-asset') },
        context: { b: asset('context-asset') },
        checks: [{ type: 'script', name: 'c', code: '', refs: { r: asset('check-asset') } }],
        iterate: { over: asset('iterate-asset'), itemAlias: 'x', itemRetryLimit: 0 },
      }),
      stage({
        key: 't',
        slots: { n: { from: 'coalesce', refs: [{ from: 'prev' }, asset('coalesce-asset')] } },
      }),
    ];
    expect(collectAssetIds(graph).sort()).toEqual([
      'check-asset',
      'coalesce-asset',
      'context-asset',
      'iterate-asset',
      'slot-asset',
    ]);
  });
});

describe('mapGraphRefs', () => {
  it('rewrites leaf refs everywhere without touching the input', () => {
    const graph = [
      stage({ slots: { n: { from: 'coalesce', refs: [asset('a'), { from: 'prev' }] } } }),
    ];
    const mapped = mapGraphRefs(graph, (ref) =>
      ref.from === 'asset' ? { from: 'asset', assetId: `@slot:${ref.assetId}` } : ref,
    );
    expect(mapped[0]!.slots.n).toEqual({
      from: 'coalesce',
      refs: [{ from: 'asset', assetId: '@slot:a' }, { from: 'prev' }],
    });
    expect(graph[0]!.slots.n).toEqual({ from: 'coalesce', refs: [asset('a'), { from: 'prev' }] });
  });
});
