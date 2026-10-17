import { describe, it, expect } from 'vitest';
import type { StageDef } from '@reelcraft/shared';
import { connectStages, disconnectStages, explicitGraph } from './dag-edit.logic';
const stage = (key: string, dependsOn?: string[]): StageDef => ({
  key,
  label: key,
  capability: 'text.generate',
  config: {},
  slots: {},
  context: {},
  output: { kind: 'text' },
  checks: [],
  ...(dependsOn && { dependsOn }),
});
describe('DAG editing', () => {
  it('creates a branch without changing the existing chain', () => {
    const graph = explicitGraph([stage('a'), stage('b'), stage('c')]);
    expect(connectStages([...graph, stage('d', [])], 'b', 'd').map((s) => s.dependsOn)).toEqual([
      [],
      ['a'],
      ['b'],
      ['b'],
    ]);
  });
  it('rejects cycles and self connections', () => {
    expect(() => connectStages([stage('a'), stage('b')], 'b', 'a')).toThrow('cycle');
    expect(() => connectStages([stage('a')], 'a', 'a')).toThrow('itself');
  });
  it('preserves prev sources when reordering', () => {
    const graph = [
      stage('a', []),
      { ...stage('b', []), slots: { text: { from: 'prev' as const } } },
      stage('c', []),
    ];
    const next = connectStages(graph, 'c', 'a');
    expect(next.map((s) => s.key)).toEqual(['c', 'a', 'b']);
    expect(next[2]!.slots.text).toEqual({ from: 'stage', stageKey: 'a' });
  });
  it('disconnects ordering and refuses to silently disconnect a binding', () => {
    expect(disconnectStages([stage('a'), stage('b')], 'a', 'b')[1]!.dependsOn).toEqual([]);
    expect(() =>
      disconnectStages(
        [stage('a'), { ...stage('b'), slots: { text: { from: 'prev' } } }],
        'a',
        'b',
      ),
    ).toThrow('binding');
  });
});
