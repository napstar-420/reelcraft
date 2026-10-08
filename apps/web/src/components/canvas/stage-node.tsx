import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Play,
  Plus,
  Square,
  Trash2,
  UserRound,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { cn } from 'cn';
import type {
  CapabilityDto,
  InputDef,
  RoleDef,
  StageDef,
  ValidationIssue,
} from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { toneDotClassName } from '@/lib/status';
import { issueCounts } from '@/pages/canvas-graph.logic';
import { START_NODE_WIDTH, STAGE_NODE_WIDTH } from '@/pages/canvas-layout.logic';
import { useCanvasActions } from './canvas-actions';
import { capabilityStyle } from './capability-style';
import {
  describeOutputKind,
  describeRef,
  stageFlags,
  type NodeRunStatus,
} from './stage-card.logic';
import { formatCapUsd } from '@/lib/format-cap';

/** Horizontal position of the memory ports along a card's bottom edge. */
const MEMORY_PORT_INSET = 34;

export type StageNodeData = {
  index: number;
  count: number;
  stage: StageDef;
  capabilityLabel: string;
  issues?: ValidationIssue[] | undefined;
  runStatus?: NodeRunStatus | undefined;
  /** Tooltip for the play button (says if an earlier stage would run again). */
  runTitle?: string | undefined;
  readOnly: boolean;
};
export type StageFlowNode = Node<StageNodeData, 'stage'>;

const PORT_CLASS = '!size-2.5 !rounded-full !border-2 !border-[var(--edge)] !bg-card';

function IoRow({ icon, name, detail }: { icon: React.ReactNode; name: string; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
      {detail ? (
        <span className="max-w-32 truncate font-mono text-[11px]" title={detail}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

function RunFooter({
  stageKey,
  status,
  runTitle,
}: {
  stageKey: string;
  status: NodeRunStatus;
  runTitle: string | undefined;
}) {
  const actions = useCanvasActions();
  const running = status.state === 'running';
  return (
    <div className="flex items-center gap-2 rounded-b-xl border-t bg-muted/50 py-1.5 pr-2 pl-3 text-xs">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          toneDotClassName[status.tone],
          running && 'animate-pulse',
        )}
      />
      <span className="font-medium whitespace-nowrap">{status.label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {status.meta}
      </span>
      {status.reviewable ? (
        <Button
          type="button"
          size="xs"
          className="nodrag nopan"
          onClick={() => actions.onReviewStage(stageKey)}
        >
          Review
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="nodrag nopan"
          title={running ? 'Cancel run' : (runTitle ?? 'Run this stage')}
          aria-label={running ? 'Cancel run' : 'Run this stage'}
          onClick={() => (running ? actions.onCancelRun() : actions.onRunStage(stageKey))}
        >
          {running ? <Square /> : <Play />}
        </Button>
      )}
    </div>
  );
}

function StageNodeView({ data, selected }: NodeProps<StageFlowNode>) {
  const { stage, index, count, capabilityLabel, issues, runStatus, runTitle, readOnly } = data;
  const actions = useCanvasActions();
  const style = capabilityStyle(stage.capability);
  const Icon = style.icon;
  const { errors, warnings } = issueCounts(issues);
  const flags = stageFlags(stage);
  const slots = Object.entries(stage.slots);
  const writes = Object.keys(stage.writes ?? {});
  const snippet = stage.instructions?.template;

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow',
        'hover:border-foreground/25',
        selected && 'border-primary shadow-md ring-3 ring-primary/25 hover:border-primary',
        errors > 0 && !selected && 'border-destructive/60',
      )}
      style={{ width: STAGE_NODE_WIDTH }}
    >
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        className={PORT_CLASS}
        style={{ top: 28 }}
      />
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className={PORT_CLASS}
        style={{ top: 28 }}
      />
      <Handle
        type="target"
        id="mem-in"
        position={Position.Bottom}
        className="!pointer-events-none !opacity-0"
        style={{ left: MEMORY_PORT_INSET }}
      />
      <Handle
        type="source"
        id="mem-out"
        position={Position.Bottom}
        className="!pointer-events-none !opacity-0"
        style={{ left: STAGE_NODE_WIDTH - MEMORY_PORT_INSET }}
      />

      <div className="pointer-events-none absolute -top-[22px] left-0.5 flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
        <b className="font-medium text-foreground/75">{String(index + 1).padStart(2, '0')}</b>
        {stage.key}
      </div>

      {!readOnly && (
        <div className="nodrag nopan absolute -top-8 right-0 hidden gap-px rounded-lg border bg-card p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Move earlier"
            aria-label="Move earlier"
            disabled={index === 0}
            onClick={() => actions.onMoveStage(stage.key, -1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Move later"
            aria-label="Move later"
            disabled={index === count - 1}
            onClick={() => actions.onMoveStage(stage.key, 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive"
            title="Delete stage"
            aria-label="Delete stage"
            onClick={() => actions.onDeleteStage(stage.key)}
          >
            <Trash2 />
          </Button>
        </div>
      )}

      <div className="flex h-14 items-center gap-2.5 px-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            style.chip,
            style.ink,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold" title={stage.label}>
            {stage.label || stage.key}
          </p>
          <p className="truncate text-xs leading-tight text-muted-foreground">{capabilityLabel}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {errors > 0 && (
            <span
              className="inline-flex h-5 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 text-[11px] font-semibold text-destructive"
              title={`${errors} error${errors === 1 ? '' : 's'}`}
            >
              <XCircle className="size-3" />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span
              className="inline-flex h-5 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
              title={`${warnings} warning${warnings === 1 ? '' : 's'}`}
            >
              <AlertTriangle className="size-3" />
              {warnings}
            </span>
          )}
        </div>
      </div>

      {snippet ? (
        <p className="mx-3 mb-2.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {snippet}
        </p>
      ) : null}

      <div className="grid gap-1.5 border-t px-3 py-2.5">
        {slots.slice(0, 3).map(([name, ref]) => (
          <IoRow
            key={name}
            icon={<ArrowDownToLine className="size-3 shrink-0" />}
            name={name}
            detail={describeRef(ref)}
          />
        ))}
        {slots.length > 3 && (
          <p className="pl-[19px] text-[11px] text-muted-foreground">+{slots.length - 3} more</p>
        )}
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
            slots.length > 0 && 'mt-0.5 border-t border-dashed pt-1.5',
          )}
        >
          <ArrowUpFromLine className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {describeOutputKind(stage.output.kind)}
          </span>
          {writes.slice(0, 2).map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-0.5 rounded bg-[var(--memory)]/10 px-1.5 py-px font-mono text-[11px] font-medium text-[var(--memory)]"
              title={`Writes memory key “${key}”`}
            >
              <Database className="size-2.5" />
              {key}
            </span>
          ))}
        </div>
      </div>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2.5">
          {flags.map((flag) => (
            <span
              key={flag.kind}
              title={flag.title}
              className={cn(
                'rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
                flag.kind === 'approval' &&
                  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
              )}
            >
              {flag.label}
            </span>
          ))}
        </div>
      )}

      {runStatus ? <RunFooter stageKey={stage.key} status={runStatus} runTitle={runTitle} /> : null}
    </div>
  );
}

export const StageNode = memo(StageNodeView);

export type StartNodeData = {
  inputs: InputDef[];
  roles: RoleDef[];
  runCapUsd: number;
};
export type StartFlowNode = Node<StartNodeData, 'start'>;

function StartNodeView({ data }: NodeProps<StartFlowNode>) {
  const actions = useCanvasActions();
  return (
    <button
      type="button"
      onClick={actions.onOpenBlueprintSettings}
      className="nodrag nopan relative block rounded-xl border border-dashed bg-card/70 text-left text-card-foreground transition-colors hover:border-primary"
      style={{ width: START_NODE_WIDTH }}
      aria-label="Blueprint inputs, role and run cap"
    >
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className={PORT_CLASS}
        style={{ top: 28 }}
      />
      <div className="pointer-events-none absolute -top-[22px] left-0.5 font-mono text-[11px] text-muted-foreground">
        Start
      </div>
      <div className="flex h-14 items-center gap-2.5 px-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ArrowDownToLine className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold">Blueprint inputs</p>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            Every run starts here
          </p>
        </div>
      </div>
      <div className="grid gap-1.5 border-t px-3 py-2.5">
        {data.inputs.length === 0 && (
          <p className="pl-[19px] text-[11px] text-muted-foreground">No inputs yet</p>
        )}
        {data.inputs.map((input) => (
          <IoRow
            key={input.key}
            icon={<ArrowDownToLine className="size-3 shrink-0" />}
            name={`${input.key}${input.required ? ' *' : ''}`}
            detail={input.accepts.kind}
          />
        ))}
        {data.roles.map((role) => (
          <IoRow
            key={role.key}
            icon={<UserRound className="size-3 shrink-0" />}
            name="Role"
            detail={role.label || role.key}
          />
        ))}
        <div className="mt-0.5 border-t border-dashed pt-1.5">
          <IoRow
            icon={<CircleDollarSign className="size-3 shrink-0" />}
            name="Run cap"
            detail={formatCapUsd(Number(data.runCapUsd))}
          />
        </div>
      </div>
    </button>
  );
}

export const StartNode = memo(StartNodeView);

export type AddNodeData = {
  /** First stage of the blueprint: show the larger empty-state card. */
  empty: boolean;
  /** Most common capabilities, offered as one-click starters when empty. */
  starters: CapabilityDto[];
  index: number;
};
export type AddFlowNode = Node<AddNodeData, 'add'>;

function AddNodeView({ data }: NodeProps<AddFlowNode>) {
  const actions = useCanvasActions();
  const target = (
    <Handle
      type="target"
      id="in"
      position={Position.Left}
      className={PORT_CLASS}
      style={{ top: 28 }}
    />
  );
  if (!data.empty) {
    return (
      <button
        type="button"
        onClick={() => actions.onOpenPalette(data.index)}
        className="nodrag nopan relative flex h-14 w-42 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-foreground/25 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
      >
        {target}
        <Plus className="size-4" />
        Add stage
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px]">A</kbd>
      </button>
    );
  }
  return (
    <div className="nodrag nopan relative grid w-[388px] gap-3 rounded-2xl border-[1.5px] border-dashed border-foreground/25 bg-card/60 p-5 text-card-foreground">
      {target}
      <div>
        <h3 className="text-base font-semibold">Add your first stage</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A blueprint is a chain of stages. Each one reads the previous output, memory or an input,
          and hands its result on.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.starters.map((capability) => {
          const style = capabilityStyle(capability.key);
          const Icon = style.icon;
          return (
            <Button
              key={capability.key}
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => actions.onAddStage(capability.key, 0)}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-md',
                  style.chip,
                  style.ink,
                )}
              >
                <Icon className="size-3" />
              </span>
              {capability.label}
            </Button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" onClick={() => actions.onOpenPalette(0)}>
        Browse all stage types
      </Button>
    </div>
  );
}

export const AddNode = memo(AddNodeView);
