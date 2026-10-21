import { cn } from 'cn';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  VIEW_LABEL,
  type Phase,
  type PhaseState,
  type RunView,
  type StageView,
  type ViewState,
} from './run-phases.logic';

const SQUARE: Record<ViewState, string> = {
  done: 'bg-emerald-500',
  running: 'bg-blue-500 animate-pulse',
  waiting: 'bg-amber-500',
  failed: 'bg-destructive',
  paused: 'border-2 border-blue-400/70',
  next: 'border-2 border-violet-400',
  pending: 'bg-muted-foreground/30',
  skipped: 'bg-muted-foreground/15',
};

const BOX: Record<PhaseState, string> = {
  done: 'border-emerald-500/60',
  partial: '',
  running: 'border-blue-500 ring-2 ring-blue-500/25',
  waiting: 'border-amber-500/70',
  failed: 'border-destructive/70',
  next: 'border-dashed border-violet-400/70',
  pending: 'opacity-60',
};

const NOTE: Partial<Record<ViewState, string>> = {
  failed: 'text-destructive',
  waiting: 'text-amber-600 dark:text-amber-400',
  running: 'text-blue-600 dark:text-blue-400',
};

function phaseNote(phase: Phase): { text: string; state: ViewState | null } {
  for (const state of ['failed', 'waiting', 'running'] as const) {
    const stage = phase.stages.find((s) => s.state === state);
    if (stage)
      return {
        state,
        text:
          state === 'failed'
            ? `Failed at ${stage.number}`
            : state === 'waiting'
              ? `${stage.number} waits for you`
              : `Running ${stage.number}`,
      };
  }
  const paused = phase.stages.find((s) => s.state === 'paused');
  if (paused) return { state: null, text: `Paused at ${paused.number}` };
  return { state: null, text: phase.state === 'next' ? 'Up next' : '' };
}

type Edge = { d: string; tone: 'live' | 'done' | 'idle' };

/** The run as a few phase boxes joined top to bottom, with one square per stage inside each. */
export function RunGraph({
  view,
  selectedKey,
  onOpenStage,
}: {
  view: RunView;
  selectedKey: string | null;
  onOpenStage: (key: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [edges, setEdges] = useState<Edge[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const setBox = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) boxes.current.set(id, el);
      else boxes.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const base = root.current?.getBoundingClientRect();
      if (!base) return;
      const byId = new Map(view.phases.map((p) => [p.id, p]));
      const next: Edge[] = [];
      for (const phase of view.phases) {
        for (const dep of phase.deps) {
          const a = boxes.current.get(dep)?.getBoundingClientRect();
          const b = boxes.current.get(phase.id)?.getBoundingClientRect();
          if (!a || !b) continue;
          const x1 = a.left - base.left + a.width / 2;
          const y1 = a.bottom - base.top;
          const x2 = b.left - base.left + b.width / 2;
          const y2 = b.top - base.top;
          const mid = (y1 + y2) / 2;
          next.push({
            d: `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`,
            tone:
              phase.state === 'running'
                ? 'live'
                : byId.get(dep)?.state === 'done'
                  ? 'done'
                  : 'idle',
          });
        }
      }
      setEdges(next);
    };
    measure();
    if (!root.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [view, open]);

  const layerCount = Math.max(0, ...view.phases.map((p) => p.column)) + 1;
  const toggle = (phase: Phase) => {
    if (phase.stages.length === 1) return onOpenStage(phase.stages[0]!.key);
    setOpen((prev) => {
      const copy = new Set(prev);
      if (!copy.delete(phase.id)) copy.add(phase.id);
      return copy;
    });
  };

  return (
    <div ref={root} className="relative flex flex-col gap-12 p-1">
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {edges.map((edge, i) => (
          <path
            key={i}
            d={edge.d}
            fill="none"
            strokeWidth={2}
            className={cn(
              edge.tone === 'live'
                ? 'stroke-blue-500'
                : edge.tone === 'done'
                  ? 'stroke-emerald-500/40'
                  : 'stroke-border',
            )}
            strokeDasharray={edge.tone === 'live' ? '5 5' : undefined}
          />
        ))}
      </svg>
      {Array.from({ length: layerCount }, (_, layer) => (
        <div key={layer} className="relative z-10 flex justify-center gap-4">
          {view.phases
            .filter((p) => p.column === layer)
            .map((phase) => (
              <div key={phase.id} className="min-w-0 max-w-sm flex-1">
                <PhaseBox
                  phase={phase}
                  expanded={open.has(phase.id)}
                  selectedKey={selectedKey}
                  boxRef={setBox(phase.id)}
                  onToggle={() => toggle(phase)}
                  onOpenStage={onOpenStage}
                />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function PhaseBox({
  phase,
  expanded,
  selectedKey,
  boxRef,
  onToggle,
  onOpenStage,
}: {
  phase: Phase;
  expanded: boolean;
  selectedKey: string | null;
  boxRef: (el: HTMLElement | null) => void;
  onToggle: () => void;
  onOpenStage: (key: string) => void;
}) {
  const note = phaseNote(phase);
  return (
    <div
      ref={boxRef}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card px-3 py-3 text-sm transition-colors',
        BOX[phase.state],
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={phase.stages.length > 1 ? expanded : undefined}
        aria-label={`${phase.name}, ${VIEW_LABEL[phase.state]}, ${phase.done} of ${phase.total} done`}
        className="flex flex-col gap-2 text-left"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">{phase.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {phase.done}/{phase.total}
          </span>
        </span>
        {phase.stages.length > 1 ? (
          <span className="flex flex-wrap gap-1">
            {phase.stages.map((s) => (
              <i
                key={s.key}
                title={`${s.number} · ${s.name}`}
                className={cn('size-3 rounded-[4px]', SQUARE[s.state])}
              />
            ))}
          </span>
        ) : null}
        <span
          className={cn('min-h-4 text-xs text-muted-foreground', note.state && NOTE[note.state])}
        >
          {note.text || (phase.stages.length === 1 ? VIEW_LABEL[phase.stages[0]!.state] : '')}
        </span>
      </button>
      {expanded ? (
        <div className="border-t pt-1">
          {phase.stages.map((s) => (
            <StageLine
              key={s.key}
              stage={s}
              selected={s.key === selectedKey}
              onOpen={onOpenStage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StageLine({
  stage,
  selected,
  onOpen,
}: {
  stage: StageView;
  selected: boolean;
  onOpen: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(stage.key)}
      className={cn(
        'flex w-full items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left text-sm hover:bg-muted',
        stage.state === 'done' && 'border-emerald-500/50',
        selected && 'bg-muted',
      )}
    >
      <i className={cn('size-2.5 shrink-0 rounded-[3px]', SQUARE[stage.state])} aria-hidden />
      <span className="w-5 text-xs text-muted-foreground tabular-nums">{stage.number}</span>
      <span className="min-w-0 flex-1 truncate">{stage.name}</span>
      <span className="sr-only">{VIEW_LABEL[stage.state]}</span>
    </button>
  );
}
