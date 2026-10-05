import { describe, expect, it } from 'vitest';
import type { CapabilityDto, StageDef, ValidationIssue } from '@reelcraft/shared';
import { problemRows } from './canvas-graph.logic';
import { START_NODE_X, stageX } from './canvas-layout.logic';
import { ADD_NODE_ID, buildStageGraph, START_NODE_ID, type FlowEdge } from './stage-graph.logic';

const trunkEdges = (edges: FlowEdge[]) => edges.flatMap((e) => (e.type === 'trunk' ? [e] : []));

function stage(key: string, patch: Partial<StageDef> = {}): StageDef {
  return {
    key,
    label: key.toUpperCase(),
    capability: 'text.generate',
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    ...patch,
  };
}

const capabilities = [
  { key: 'text.generate', label: 'Generate Text' },
  { key: 'image.generate', label: 'Generate Image' },
] as CapabilityDto[];

function build(graph: StageDef[], extra: Partial<Parameters<typeof buildStageGraph>[0]> = {}) {
  return buildStageGraph({
    graph,
    inputs: [],
    roles: [],
    runCapUsd: 5,
    capabilities,
    issuesByStage: new Map(),
    selectedKey: null,
    run: undefined,
    readOnly: false,
    showMemoryLinks: true,
    ...extra,
  });
}

describe('buildStageGraph', () => {
  const graph = [
    stage('a', { writes: { k: '$' } }),
    stage('b'),
    stage('c', { slots: { x: { from: 'memory', key: 'k' } } }),
  ];

  it('lays the Start node, stages and Add card out along the trunk', () => {
    const { nodes } = build(graph);
    expect(nodes.map((n) => [n.id, n.position.x])).toEqual([
      [START_NODE_ID, START_NODE_X],
      ['a', stageX(0)],
      ['b', stageX(1)],
      ['c', stageX(2)],
      [ADD_NODE_ID, stageX(3)],
    ]);
  });

  it('puts the capability label and selection on the stage nodes', () => {
    const { nodes } = build(graph, { selectedKey: 'b' });
    const b = nodes.find((n) => n.id === 'b');
    expect(b?.selected).toBe(true);
    expect(b?.type === 'stage' && b.data.capabilityLabel).toBe('Generate Text');
  });

  it('connects the trunk with an insert slot on every connector except the last', () => {
    const trunk = trunkEdges(build(graph).edges);
    expect(trunk.map((e) => [e.source, e.target, e.data?.insertIndex])).toEqual([
      [START_NODE_ID, 'a', 0],
      ['a', 'b', 1],
      ['b', 'c', 2],
      ['c', ADD_NODE_ID, undefined],
    ]);
  });

  it('adds a memory link from the writer to the reader, and can hide them', () => {
    const memory = build(graph).edges.filter((e) => e.type === 'memory');
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      source: 'a',
      target: 'c',
      data: { memoryKey: 'k', ambiguous: false, writerLabel: 'A', readerLabel: 'C' },
    });
    expect(build(graph, { showMemoryLinks: false }).edges.some((e) => e.type === 'memory')).toBe(
      false,
    );
  });

  it('makes the Add card the empty-state hero on an empty graph', () => {
    const { nodes, edges } = build([]);
    const add = nodes.find((n) => n.id === ADD_NODE_ID);
    expect(add?.type === 'add' && add.data.empty).toBe(true);
    expect(add?.type === 'add' && add.data.starters.map((c) => c.key)).toEqual([
      'text.generate',
      'image.generate',
    ]);
    expect(edges.map((e) => [e.source, e.target])).toEqual([[START_NODE_ID, ADD_NODE_ID]]);
  });

  it('is read-only: no Add card, no dragging, no insert slots, no run footer', () => {
    const { nodes, edges } = build(graph, { readOnly: true });
    expect(nodes.some((n) => n.id === ADD_NODE_ID)).toBe(false);
    expect(nodes.filter((n) => n.type === 'stage').every((n) => n.draggable === false)).toBe(true);
    expect(edges.some((e) => e.target === ADD_NODE_ID)).toBe(false);
    expect(trunkEdges(edges).every((e) => e.data?.readOnly)).toBe(true);
  });
});

describe('problemRows', () => {
  const graph = [stage('a'), stage('b')];
  const issues: ValidationIssue[] = [
    { path: 'stages.b.slots.x', message: 'b problem', severity: 'error' },
    { path: 'graph', message: 'whole blueprint', severity: 'error' },
    { path: 'stages.a.output', message: 'a problem', severity: 'warning' },
  ];

  it('lists graph-level issues first, then stages in graph order', () => {
    expect(problemRows(graph, issues).map((r) => r.issue.message)).toEqual([
      'whole blueprint',
      'a problem',
      'b problem',
    ]);
  });

  it('names the stage by its label', () => {
    expect(problemRows(graph, issues).map((r) => r.stageLabel)).toEqual([undefined, 'A', 'B']);
  });
});
