import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StageGraphInput } from '@/pages/stage-graph.logic';
import {
  ADD_NODE_ID,
  buildStageGraph,
  START_NODE_ID,
  type FlowNode,
} from '@/pages/stage-graph.logic';
import {
  dropIndex,
  NODE_TOP_Y,
  START_NODE_X,
  STAGE_NODE_WIDTH,
  stageX,
} from '@/pages/canvas-layout.logic';
import { MemoryEdge, TrunkEdge } from './stage-edges';
import { AddNode, StageNode, StartNode } from './stage-node';

const nodeTypes = { stage: StageNode, start: StartNode, add: AddNode };
const edgeTypes = { trunk: TrunkEdge, memory: MemoryEdge };

/** Zoom the canvas opens at and refocuses to: big enough to read a card. */
const READABLE_ZOOM = 0.86;
const FOCUS_ZOOM = 0.86;

/** Carries the measured size across a rebuild, or React Flow hides the node
 * until it measures it again. */
function keepMeasured(next: FlowNode[], previous: FlowNode[]): FlowNode[] {
  const measured = new Map(previous.map((n) => [n.id, n.measured]));
  return next.map((node) => {
    const size = measured.get(node.id);
    return size ? { ...node, measured: size } : node;
  });
}

/** Imperative handle used by the page to move the viewport. */
export type StageGraphApi = {
  focusStage: (index: number) => void;
};

export function useStageGraphApi(): StageGraphApi {
  const { setCenter } = useReactFlow();
  return useMemo(
    () => ({
      focusStage(index: number) {
        void setCenter(stageX(index) + STAGE_NODE_WIDTH / 2, NODE_TOP_Y + 150, {
          zoom: FOCUS_ZOOM,
          duration: 300,
        });
      },
    }),
    [setCenter],
  );
}

/** The React Flow canvas: Start node, one card per stage, the trunk
 * connectors with their insert buttons, and the memory links. Stages only
 * move sideways; dropping one on another slot reorders the graph. */
export function StageGraph({
  input,
  onSelectStage,
  onClearSelection,
  onOpenBlueprintSettings,
  onReorder,
  initialFocusIndex,
}: {
  input: StageGraphInput;
  onSelectStage: (stageKey: string) => void;
  onClearSelection: () => void;
  onOpenBlueprintSettings: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  initialFocusIndex: number | null;
}) {
  const derived = useMemo(() => buildStageGraph(input), [input]);
  const [nodes, setNodes] = useState<FlowNode[]>(derived.nodes);
  const dragging = useRef(false);
  const latest = useRef(derived.nodes);
  latest.current = derived.nodes;

  useEffect(() => {
    if (dragging.current) return;
    setNodes((previous) => keepMeasured(derived.nodes, previous));
  }, [derived.nodes]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    // Cards slide along the trunk only.
    const locked = changes.map((change) =>
      change.type === 'position' && change.position
        ? { ...change, position: { x: change.position.x, y: NODE_TOP_Y } }
        : change,
    );
    setNodes((previous) => applyNodeChanges(locked, previous));
  }, []);

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(() => {
    dragging.current = true;
  }, []);

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, node) => {
      dragging.current = false;
      const from = input.graph.findIndex((s) => s.key === node.id);
      const to = dropIndex(node.position.x, input.graph.length);
      if (from === -1 || from === to) {
        // Not moved: put the card back on its slot.
        setNodes((previous) => keepMeasured(latest.current, previous));
        return;
      }
      onReorder(from, to);
    },
    [input.graph, onReorder],
  );

  const { setViewport } = useReactFlow();
  const focused = useRef(false);
  const onInit = useCallback(() => {
    if (focused.current) return;
    focused.current = true;
    if (initialFocusIndex !== null) {
      void setViewport({
        x: 360 - (stageX(initialFocusIndex) + STAGE_NODE_WIDTH / 2) * FOCUS_ZOOM,
        y: 32,
        zoom: FOCUS_ZOOM,
      });
      return;
    }
    void setViewport({ x: 40 - START_NODE_X * READABLE_ZOOM, y: 32, zoom: READABLE_ZOOM });
  }, [initialFocusIndex, setViewport]);

  return (
    <ReactFlow<FlowNode>
      className="stage-canvas"
      nodes={nodes}
      edges={derived.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={onInit}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_event, node: Node) => {
        if (node.id === START_NODE_ID) onOpenBlueprintSettings();
        else if (node.id !== ADD_NODE_ID) onSelectStage(node.id);
      }}
      onPaneClick={onClearSelection}
      nodesConnectable={false}
      elementsSelectable
      selectNodesOnDrag={false}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      minZoom={0.25}
      maxZoom={1.6}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} />
    </ReactFlow>
  );
}
