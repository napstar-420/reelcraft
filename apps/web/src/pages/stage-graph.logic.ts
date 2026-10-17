import type {
  BlueprintPresentation,
  CapabilityDto,
  RunDetailDto,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import type { AddFlowNode, StageFlowNode, StartFlowNode } from '../components/canvas/stage-node';
import type {
  MemoryFlowEdge,
  TrunkEdgeData,
  TrunkFlowEdge,
} from '../components/canvas/stage-edges';
import {
  nodeRunStatus,
  runStageTitle,
  upstreamBlocker,
} from '../components/canvas/stage-card.logic';
import { memoryLinks } from './canvas-graph.logic';
import { NODE_TOP_Y, START_NODE_X, stageLayout, stageX, stageY } from './canvas-layout.logic';
import { ancestorsOf, descendantsOf, stageDependencies } from '../lib/stage-deps';

export const START_NODE_ID = '__start__';
export const ADD_NODE_ID = '__add__';

/** One-click starters shown on an empty canvas, in this order. */
const STARTER_CAPABILITIES = ['text.generate', 'image.generate', 'video.generate', 'audio.speech'];

export type FlowNode = StartFlowNode | StageFlowNode | AddFlowNode;
export type FlowEdge = TrunkFlowEdge | MemoryFlowEdge;

export type StageGraphInput = {
  presentation?: BlueprintPresentation | undefined;
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

/** Saved positions override the deterministic dependency-layer layout. */
export function buildStageGraph(input: StageGraphInput): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { graph, readOnly } = input;
  const layout = stageLayout(graph);
  const deps = stageDependencies(graph);
  const relevant = input.selectedKey
    ? new Set([
        input.selectedKey,
        ...ancestorsOf(deps, input.selectedKey),
        ...descendantsOf(deps, input.selectedKey),
      ])
    : null;
  const lastColumn = layout.reduce((max, slot) => Math.max(max, slot.level), -1);
  const labelOf = new Map(input.capabilities.map((c) => [c.key, c.label]));
  const executions = new Map(input.run?.stageExecutions.map((e) => [e.stageKey, e]));
  const keys = new Set(graph.map((s) => s.key));
  const labelOfStage = (key: string) => graph.find((s) => s.key === key)?.label ?? key;

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
      position: input.presentation?.positions[stage.key] ?? {
        x: stageX(layout[index]!.level),
        y: stageY(layout[index]!.lane),
      },
      draggable: !readOnly,
      selected: stage.key === input.selectedKey,
      deletable: false,
      data: {
        index,
        branchName: input.presentation?.branchNames[stage.key],
        modelLabel: (() => {
          const model = input.run?.resolvedConfig[stage.key]?.model ?? stage.model;
          return model
            ? `${model.provider ?? 'Inherited'} / ${model.modelId ?? 'default'}`
            : 'Inherited model';
        })(),
        costUsd: executions.get(stage.key)?.costUsd,
        failureReason: (() => {
          const failure = executions.get(stage.key)?.failure;
          return failure && typeof failure === 'object' && 'reason' in failure
            ? String(failure.reason)
            : undefined;
        })(),
        count: graph.length,
        stage,
        capabilityLabel: labelOf.get(stage.capability) ?? stage.capability,
        issues: input.issuesByStage.get(stage.key),
        runStatus: readOnly ? undefined : nodeRunStatus(executions.get(stage.key), input.run),
        runTitle: readOnly
          ? undefined
          : runStageTitle(upstreamBlocker(input.run, graph, stage.key), labelOfStage),
        readOnly,
      },
    })),
  ];

  if (!readOnly) {
    nodes.push({
      id: ADD_NODE_ID,
      type: 'add',
      position: {
        x: stageX(lastColumn + 1),
        y: stageY(layout[graph.length - 1]?.lane ?? 0),
      },
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
    selectable: source !== START_NODE_ID && target !== ADD_NODE_ID,
    focusable: source !== START_NODE_ID && target !== ADD_NODE_ID,
    data: {
      ...data,
      highlighted: !!relevant?.has(source) && !!relevant?.has(target),
      faded: !!relevant && !(relevant.has(source) && relevant.has(target)),
    },
  });
  // Start feeds every stage that waits for nothing. The `+` on a connector
  // inserts a stage at that point, so only the connector a stage gets by
  // default (from the stage before it) carries one.
  graph.forEach((stage, index) => {
    if ((deps.get(stage.key) ?? []).length === 0) {
      edges.push(
        trunk(START_NODE_ID, stage.key, {
          readOnly,
          ...(index === 0 ? { insertIndex: 0 } : {}),
        }),
      );
    }
  });
  for (const [from, to] of graph.flatMap((stage) =>
    (deps.get(stage.key) ?? []).map((dep) => [dep, stage.key] as [string, string]),
  )) {
    const index = graph.findIndex((s) => s.key === to);
    const implicit = graph[index]!.dependsOn === undefined && graph[index - 1]?.key === from;
    edges.push(trunk(from, to, { readOnly, ...(implicit ? { insertIndex: index } : {}) }));
  }
  if (!readOnly) {
    edges.push(trunk(graph[graph.length - 1]?.key ?? START_NODE_ID, ADD_NODE_ID, { readOnly }));
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
