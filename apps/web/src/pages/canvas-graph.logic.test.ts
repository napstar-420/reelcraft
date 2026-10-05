import { describe, expect, it } from 'vitest';
import type { StageDef, ValidationIssue } from '@reelcraft/shared';
import {
  graphLevelIssues,
  groupIssuesByStage,
  insertStage,
  issueCounts,
  memoryKeysReadByStage,
  memoryLinks,
  moveStage,
} from './canvas-graph.logic';

function stage(key: string, patch: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key,
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...patch,
  };
}

const keys = (graph: StageDef[]) => graph.map((s) => s.key);

describe('moveStage', () => {
  const graph = [stage('a'), stage('b'), stage('c'), stage('d')];

  it('moves a stage later and earlier', () => {
    expect(keys(moveStage(graph, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(keys(moveStage(graph, 3, 1))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same graph when nothing moves', () => {
    expect(moveStage(graph, 2, 2)).toBe(graph);
    expect(moveStage(graph, 9, 0)).toBe(graph);
  });

  it('does not mutate its input', () => {
    moveStage(graph, 0, 3);
    expect(keys(graph)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('insertStage', () => {
  const graph = [stage('a'), stage('b')];

  it('inserts in the middle, at the start and at the end', () => {
    expect(keys(insertStage(graph, stage('x'), 1))).toEqual(['a', 'x', 'b']);
    expect(keys(insertStage(graph, stage('x'), 0))).toEqual(['x', 'a', 'b']);
    expect(keys(insertStage(graph, stage('x'), 2))).toEqual(['a', 'b', 'x']);
  });

  it('clamps an out-of-range index', () => {
    expect(keys(insertStage(graph, stage('x'), 99))).toEqual(['a', 'b', 'x']);
    expect(keys(insertStage(graph, stage('x'), -3))).toEqual(['x', 'a', 'b']);
  });

  it('works on an empty graph and does not mutate', () => {
    expect(keys(insertStage([], stage('x'), 0))).toEqual(['x']);
    insertStage(graph, stage('x'), 1);
    expect(keys(graph)).toEqual(['a', 'b']);
  });
});

describe('memoryKeysReadByStage', () => {
  it('collects memory refs from slots, context, iterate and script checks', () => {
    const reader = stage('r', {
      slots: { a: { from: 'memory', key: 'one' }, b: { from: 'prev' } },
      context: { c: { from: 'memory', key: 'two' } },
      iterate: {
        over: { from: 'memory', key: 'three' },
        itemAlias: 'item',
        itemRetryLimit: 0,
      },
      checks: [
        {
          type: 'script',
          name: 'x',
          code: '',
          refs: { r: { from: 'memory', key: 'four' } },
        },
        { type: 'builtin', key: 'k', params: {} },
      ],
    });
    expect(memoryKeysReadByStage(reader).sort()).toEqual(['four', 'one', 'three', 'two']);
  });

  it('de-duplicates repeated keys', () => {
    const reader = stage('r', {
      slots: { a: { from: 'memory', key: 'one' } },
      context: { c: { from: 'memory', key: 'one' } },
    });
    expect(memoryKeysReadByStage(reader)).toEqual(['one']);
  });
});

describe('memoryLinks', () => {
  it('links the writer of a key to each stage that reads it', () => {
    const graph = [
      stage('w', { writes: { script: '$' } }),
      stage('r1', { slots: { t: { from: 'memory', key: 'script' } } }),
      stage('r2', { context: { t: { from: 'memory', key: 'script' } } }),
    ];
    expect(memoryLinks(graph)).toEqual([
      { key: 'script', from: 'w', to: 'r1', ambiguous: false },
      { key: 'script', from: 'w', to: 'r2', ambiguous: false },
    ]);
  });

  it('draws one link per writer and flags a key with several writers', () => {
    const graph = [
      stage('w1', { writes: { k: '$' } }),
      stage('w2', { writes: { k: '$.x' } }),
      stage('r', { slots: { t: { from: 'memory', key: 'k' } } }),
    ];
    expect(memoryLinks(graph)).toEqual([
      { key: 'k', from: 'w1', to: 'r', ambiguous: true },
      { key: 'k', from: 'w2', to: 'r', ambiguous: true },
    ]);
  });

  it('skips a stage reading its own write and keys nobody writes', () => {
    const graph = [
      stage('s', { writes: { k: '$' }, slots: { t: { from: 'memory', key: 'k' } } }),
      stage('r', { slots: { t: { from: 'memory', key: 'unwritten' } } }),
    ];
    expect(memoryLinks(graph)).toEqual([]);
  });
});

describe('issue helpers', () => {
  const issues: ValidationIssue[] = [
    { path: 'stages.a.slots.x', message: 'unbound', severity: 'error' },
    { path: 'stages.a.output', message: 'odd', severity: 'warning' },
    { path: 'stages.b', message: 'bad', severity: 'warning' },
    { path: 'graph', message: 'last stage', severity: 'error' },
  ];

  it('groups issues under their stage and leaves graph-level ones out', () => {
    const byStage = groupIssuesByStage(issues);
    expect([...byStage.keys()]).toEqual(['a', 'b']);
    expect(byStage.get('a')).toHaveLength(2);
  });

  it('returns only the graph-level issues for the banner', () => {
    expect(graphLevelIssues(issues).map((i) => i.message)).toEqual(['last stage']);
  });

  it('counts errors and warnings', () => {
    expect(issueCounts(issues)).toEqual({ errors: 2, warnings: 2 });
    expect(issueCounts(undefined)).toEqual({ errors: 0, warnings: 0 });
  });
});
