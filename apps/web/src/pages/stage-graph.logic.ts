import type { CapabilityDto, RunDetailDto, StageDef, ValidationIssue } from '@reelcraft/shared';
import type { AddFlowNode, StageFlowNode, StartFlowNode } from '../components/canvas/stage-node';
import type {
  MemoryFlowEdge,
  TrunkEdgeData,
  TrunkFlowEdge,
} from '../components/canvas/stage-edges';
import { nodeRunStatus } from '../components/canvas/stage-card.logic';
import { memoryLinks } from './canvas-graph.logic';
import { NODE_TOP_Y, START_NODE_X, stageX } from './canvas-layout.logic';

export const START_NODE_ID = '__start__';
export const ADD_NODE_ID = '__add__';

/** One-click starters shown on an empty canvas, in this order. */
const STARTER_CAPABILITIES = ['text.generate', 'image.generate', 'video.generate', 'audio.speech'];

export type FlowNode = StartFlowNode | StageFlowNode | AddFlowNode;
export type FlowEdge = TrunkFlowEdge | MemoryFlowEdge;

export type StageGraphInput = {
  graph: StageDef[];
  inputs: StartFlowNode['data']['inputs'];
  roles: StartFlowNode['data']['roles'];
  runCapUsd: number;
  capabilities: CapabilityDto[];
  issuesByStage: Map<string, ValidationIssue[]>;
  selectedKey: string | null;
  run: RunDetailDto | undefined;
  readOnly: boolean;
  showMemoryLinks: boolean;
};

/** Trunk layout: x = array index × fixed spacing, recomputed from the graph
 * on every change and never persisted. The Start node sits one slot before
 * the first stage; the "Add stage" card one slot after the last. */
export function buildStageGraph(input: StageGraphInput): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { graph, readOnly } = input;
  const labelOf = new Map(input.capabilities.map((c) => [c.key, c.label]));
  const executions = new Map(input.run?.stageExecutions.map((e) => [e.stageKey, e]));
  const keys = new Set(graph.map((s) => s.key));

  const nodes: FlowNode[] = [
    {
      id: START_NODE_ID,
      type: 'start',
      position: { x: START_NODE_X, y: NODE_TOP_Y },
      draggable: false,
      selectable: false,
      data: { inputs: input.inputs, roles: input.roles, runCapUsd: input.runCapUsd },
    },
    ...graph.map<StageFlowNode>((stage, index) => ({
      id: stage.key,
      type: 'stage',
      position: { x: stageX(index), y: NODE_TOP_Y },
      draggable: !readOnly,
      selected: stage.key === input.selectedKey,
      data: {
        index,
        count: graph.length,
        stage,
        capabilityLabel: labelOf.get(stage.capability) ?? stage.capability,
        issues: input.issuesByStage.get(stage.key),
        runStatus: readOnly ? undefined : nodeRunStatus(executions.get(stage.key), input.run),
        readOnly,
      },
    })),
  ];

  if (!readOnly) {
    nodes.push({
      id: ADD_NODE_ID,
      type: 'add',
      position: { x: stageX(graph.length), y: NODE_TOP_Y },
      draggable: false,
      selectable: false,
      data: {
        empty: graph.length === 0,
        index: graph.length,
        starters: STARTER_CAPABILITIES.flatMap((key) =>
          input.capabilities.filter((c) => c.key === key),
        ),
      },
    });
  }

  const edges: FlowEdge[] = [];
  const trunk = (source: string, target: string, data: TrunkEdgeData): TrunkFlowEdge => ({
    id: `trunk:${source}->${target}`,
    type: 'trunk',
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    selectable: false,
    focusable: false,
    data,
  });
  const chain = [START_NODE_ID, ...graph.map((s) => s.key)];
  chain.forEach((source, index) => {
    const next = graph[index];
    if (next) edges.push(trunk(source, next.key, { insertIndex: index, readOnly }));
  });
  if (!readOnly) {
    edges.push(trunk(chain[chain.length - 1] ?? START_NODE_ID, ADD_NODE_ID, { readOnly }));
  }

  if (input.showMemoryLinks) {
    const indexOf = new Map(graph.map((s, i) => [s.key, i]));
    const labelFor = (key: string) => graph.find((s) => s.key === key)?.label ?? key;
    for (const link of memoryLinks(graph)) {
      if (!keys.has(link.from) || !keys.has(link.to)) continue;
      const span = Math.abs((indexOf.get(link.to) ?? 0) - (indexOf.get(link.from) ?? 0));
      edges.push({
        id: `mem:${link.key}:${link.from}->${link.to}`,
        type: 'memory',
        source: link.from,
        target: link.to,
        sourceHandle: 'mem-out',
        targetHandle: 'mem-in',
        selectable: false,
        focusable: false,
        data: {
          memoryKey: link.key,
          ambiguous: link.ambiguous,
          depth: 36 + span * 15,
          writerLabel: labelFor(link.from),
          readerLabel: labelFor(link.to),
        },
      });
    }
  }
  return { nodes, edges };
}
