import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { Database, Plus } from 'lucide-react';
import { cn } from 'cn';
import { useCanvasActions } from './canvas-actions';

export type TrunkEdgeData = {
  /** Slot a stage inserted from this connector's `+` takes. Absent on the
   * closing connector that leads to the "Add stage" card. */
  insertIndex?: number;
  readOnly: boolean;
};
export type TrunkFlowEdge = Edge<TrunkEdgeData, 'trunk'>;

/** The straight connector between neighbouring nodes, with a `+` on it that
 * inserts a stage at that point. Hidden until the canvas is hovered or the
 * button is focused. */
export function TrunkEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<TrunkFlowEdge>) {
  const actions = useCanvasActions();
  const path = `M ${sourceX + 4} ${sourceY} L ${targetX - 6} ${targetY}`;
  const arrow = `M ${targetX - 12} ${targetY - 4} L ${targetX - 6} ${targetY} L ${targetX - 12} ${targetY + 4}`;
  const insertIndex = data?.insertIndex;
  return (
    <>
      <BaseEdge
        path={path}
        // The connector isn't selectable, and its invisible hit area would
        // sit over the insert button and swallow its clicks.
        interactionWidth={0}
        style={{
          stroke: 'var(--edge)',
          strokeWidth: 1.75,
          strokeDasharray: insertIndex === undefined ? '5 5' : undefined,
        }}
      />
      {insertIndex !== undefined && (
        <path
          d={arrow}
          fill="none"
          stroke="var(--edge)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {insertIndex !== undefined && !data?.readOnly && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Insert a stage here"
            aria-label="Insert a stage here"
            onClick={() => actions.onOpenPalette(insertIndex)}
            // Placed with left/top: the `scale` utility is applied before
            // `transform`, so a translate in `transform` would be scaled too and
            // the button would slide away from the pointer on hover.
            className="nodrag nopan pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground opacity-0 transition-[opacity,scale,color,border-color] group-hover/canvas:opacity-60 hover:scale-110 hover:border-primary hover:text-primary hover:opacity-100 focus-visible:opacity-100"
            style={{ left: (sourceX + targetX) / 2, top: sourceY }}
          >
            <Plus className="size-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export type MemoryEdgeData = {
  memoryKey: string;
  ambiguous: boolean;
  /** How far the arc drops below the cards; longer links drop further so
   * they don't run along the shorter ones. */
  depth: number;
  writerLabel: string;
  readerLabel: string;
};
export type MemoryFlowEdge = Edge<MemoryEdgeData, 'memory'>;

/** A write → read link through the run's memory, drawn as a dashed loop under
 * the trunk with the key on it. A key with several writers is drawn in the
 * warning colour, one arc per writer. */
export function MemoryEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<MemoryFlowEdge>) {
  if (!data) return null;
  const { depth, ambiguous } = data;
  const color = ambiguous ? 'var(--destructive)' : 'var(--memory)';
  const path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + depth} ${targetX} ${targetY + depth} ${targetX} ${targetY}`;
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2 + 0.75 * depth;
  return (
    <>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeDasharray="5 4"
        opacity={0.85}
        className="motion-safe:animate-[memory-flow_1.4s_linear_infinite]"
      />
      <circle cx={sourceX} cy={sourceY} r={3.5} fill={color} />
      <circle cx={targetX} cy={targetY} r={3.5} fill={color} />
      <EdgeLabelRenderer>
        <span
          className={cn(
            'nodrag nopan pointer-events-auto absolute inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-2 pl-1.5 font-mono text-[11px] font-medium whitespace-nowrap',
            ambiguous
              ? 'border-destructive/55 text-destructive'
              : 'border-[var(--memory)]/45 text-[var(--memory)]',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={`Memory “${data.memoryKey}”: written by ${data.writerLabel}, read by ${data.readerLabel}${ambiguous ? '. More than one stage writes this key.' : ''}`}
        >
          <Database className="size-2.5" />
          {data.memoryKey}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
