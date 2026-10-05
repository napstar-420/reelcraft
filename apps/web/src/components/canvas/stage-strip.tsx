import { AlertTriangle, Maximize, Minus, Plus, XCircle } from 'lucide-react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { cn } from 'cn';
import type { StageDef, ValidationIssue } from '@reelcraft/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toneDotClassName, type StatusTone } from '@/lib/status';
import { problemRows } from '@/pages/canvas-graph.logic';
import { capabilityStyle } from './capability-style';

function ProblemsButton({
  graph,
  issues,
  onSelectStage,
}: {
  graph: StageDef[];
  issues: ValidationIssue[];
  onSelectStage: (stageKey: string) => void;
}) {
  if (issues.length === 0) return null;
  const hasError = issues.some((i) => i.severity === 'error');
  const rows = problemRows(graph, issues);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(hasError && 'text-destructive')}
        >
          {hasError ? <XCircle /> : <AlertTriangle />}
          {issues.length} problem{issues.length === 1 ? '' : 's'}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[min(25rem,90vw)]">
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5 text-sm font-semibold">
          Problems <span className="font-normal text-muted-foreground">{issues.length}</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {rows.map(({ issue, stageKey, stageLabel }, index) => {
            const Icon = issue.severity === 'error' ? XCircle : AlertTriangle;
            const body = (
              <>
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    issue.severity === 'error'
                      ? 'text-destructive'
                      : 'text-amber-600 dark:text-amber-400',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm leading-snug">{issue.message}</span>
                  <span className="block text-xs text-muted-foreground">
                    {stageLabel ?? 'Whole blueprint'}
                  </span>
                </span>
              </>
            );
            return (
              <li key={index}>
                {stageKey ? (
                  <button
                    type="button"
                    onClick={() => onSelectStage(stageKey)}
                    className="flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex gap-2.5 px-2.5 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The canvas's bottom bar: every stage as a pill (an overview that doubles
 * as keyboard-reachable navigation), the problems list and the zoom controls.
 * Must render inside the `ReactFlowProvider`. */
export function StageStrip({
  graph,
  selectedKey,
  issues,
  statusTone,
  onSelectStage,
}: {
  graph: StageDef[];
  selectedKey: string | null;
  issues: ValidationIssue[];
  /** Run-state tone per stage key, when the canvas has an active run. */
  statusTone: (stageKey: string) => StatusTone | undefined;
  onSelectStage: (stageKey: string) => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="relative z-10 flex h-12 shrink-0 items-center gap-2.5 border-t bg-card py-0 pr-2.5 pl-3.5">
      <span className="hidden text-[11px] font-medium tracking-wider text-muted-foreground uppercase sm:block">
        Stages
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
        {graph.length === 0 && <span className="text-xs text-muted-foreground">No stages yet</span>}
        {graph.map((stage, index) => {
          const style = capabilityStyle(stage.capability);
          const tone = statusTone(stage.key);
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => onSelectStage(stage.key)}
              aria-current={selectedKey === stage.key}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border bg-card pr-2.5 pl-2 text-xs font-medium whitespace-nowrap hover:bg-muted',
                selectedKey === stage.key && 'border-primary bg-primary/10 hover:bg-primary/10',
              )}
            >
              <span className={cn('size-2 rounded-[3px]', style.chip)} />
              <span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span>
              {stage.label || stage.key}
              {tone && <span className={cn('size-2 rounded-full', toneDotClassName[tone])} />}
            </button>
          );
        })}
      </div>
      <ProblemsButton graph={graph} issues={issues} onSelectStage={onSelectStage} />
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => void zoomOut({ duration: 150 })}
        >
          <Minus />
        </Button>
        <span className="min-w-11 text-center font-mono text-xs text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => void zoomIn({ duration: 150 })}
        >
          <Plus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Fit all stages"
          aria-label="Fit all stages"
          onClick={() => void fitView({ padding: 0.12, minZoom: 0.25, maxZoom: 1, duration: 250 })}
        >
          <Maximize />
        </Button>
      </div>
    </div>
  );
}
