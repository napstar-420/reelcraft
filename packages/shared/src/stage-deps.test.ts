import { describe, expect, it } from 'vitest';
import type { Ref } from './ref';
import type { StageDef } from './stage-def';
import {
  ancestorsOf,
  descendantsOf,
  memoryBaseKey,
  memoryWritersBefore,
  producerOf,
  stageDependencies,
  stageRefLeaves,
} from './stage-deps';

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
  };
}

const prev: Ref = { from: 'prev' };
const mem = (key: string): Ref => ({ from: 'memory', key });

describe('memoryBaseKey', () => {
  it('strips an item suffix', () => {
    expect(memoryBaseKey('keyframe#3')).toBe('keyframe');
    expect(memoryBaseKey('keyframe')).toBe('keyframe');
  });
});

describe('stageRefLeaves', () => {
  it('collects slots, context, iterate.over and script-check refs, flattening coalesce', () => {
    const s = stage('a', {
      slots: { one: { from: 'coalesce', refs: [prev, mem('k')] } },
      context: { two: { from: 'input', inputKey: 'topic' } },
      iterate: { over: mem('scenes'), itemAlias: 's', itemRetryLimit: 0 },
      checks: [
        {
          type: 'script',
          id: 'c',
          refs: { r: mem('other') },
        } as unknown as StageDef['checks'][number],
      ],
    });
    expect(stageRefLeaves(s).map((r) => r.from)).toEqual([
      'prev',
      'memory',
      'input',
      'memory',
      'memory',
    ]);
  });
});

describe('producerOf', () => {
  const graph = [{ key: 'a' }, { key: 'b' }];
  it('names the previous stage for prev', () => {
    expect(producerOf(prev, graph, 1)).toBe('a');
    expect(producerOf(prev, graph, 0)).toBeUndefined();
  });
  it('is undefined for refs that do not read a stage', () => {
    expect(producerOf({ from: 'input', inputKey: 'x' }, graph, 1)).toBeUndefined();
  });
});

describe('memoryWritersBefore', () => {
  const graph = [
    stage('a', { writes: { script: '$' } }),
    stage('b', { writes: { other: '$' } }),
    stage('c', { writes: { script: '$' } }),
  ];
  it('lists only earlier writers of the base key', () => {
    expect(memoryWritersBefore(graph, 'script#2', 2)).toEqual(['a']);
    expect(memoryWritersBefore(graph, 'script', 3)).toEqual(['a', 'c']);
    expect(memoryWritersBefore(graph, 'script', 0)).toEqual([]);
  });
});

describe('stageDependencies', () => {
  it('makes a graph without dependsOn a chain', () => {
    const deps = stageDependencies([stage('a'), stage('b'), stage('c')]);
    expect(deps.get('a')).toEqual([]);
    expect(deps.get('b')).toEqual(['a']);
    expect(deps.get('c')).toEqual(['b']);
  });

  it('lets dependsOn: [] start a stage on its own', () => {
    const deps = stageDependencies([stage('a'), stage('b', { dependsOn: [] })]);
    expect(deps.get('b')).toEqual([]);
  });

  it('still waits for a stage whose output a prev ref reads', () => {
    const deps = stageDependencies([stage('a'), stage('b', { dependsOn: [], slots: { x: prev } })]);
    expect(deps.get('b')).toEqual(['a']);
  });

  it('depends on earlier memory writers only', () => {
    const deps = stageDependencies([
      stage('a', { writes: { k: '$' } }),
      stage('b', { dependsOn: [], context: { k: mem('k#1') } }),
      stage('c', { dependsOn: [], writes: { k: '$' } }),
    ]);
    expect(deps.get('b')).toEqual(['a']);
    expect(deps.get('c')).toEqual([]);
  });

  it('reads a ref inside coalesce', () => {
    const deps = stageDependencies([
      stage('a', { writes: { k: '$' } }),
      stage('b'),
      stage('c', {
        dependsOn: [],
        slots: { x: { from: 'coalesce', refs: [mem('k'), { from: 'const', value: 1 }] } },
      }),
    ]);
    expect(deps.get('c')).toEqual(['a']);
  });

  it('de-duplicates and keeps unknown keys for the validator to report', () => {
    const deps = stageDependencies([
      stage('a'),
      stage('b', { dependsOn: ['a', 'ghost', 'a'], slots: { x: prev } }),
    ]);
    expect(deps.get('b')).toEqual(['a', 'ghost']);
  });
});

describe('ancestorsOf / descendantsOf on a diamond', () => {
  const deps = stageDependencies([
    stage('a'),
    stage('b', { dependsOn: ['a'] }),
    stage('c', { dependsOn: ['a'] }),
    stage('d', { dependsOn: ['b', 'c'] }),
  ]);

  it('finds ancestors through both branches', () => {
    expect([...ancestorsOf(deps, 'd')].sort()).toEqual(['a', 'b', 'c']);
    expect([...ancestorsOf(deps, 'b')]).toEqual(['a']);
    expect([...ancestorsOf(deps, 'a')]).toEqual([]);
  });

  it('finds descendants and leaves siblings out', () => {
    expect([...descendantsOf(deps, 'a')].sort()).toEqual(['b', 'c', 'd']);
    expect([...descendantsOf(deps, 'b')]).toEqual(['d']);
  });

  it('terminates on a self dependency', () => {
    const cyclic = new Map([['a', ['a']]]);
    expect([...ancestorsOf(cyclic, 'a')]).toEqual([]);
  });
});
