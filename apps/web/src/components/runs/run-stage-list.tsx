import { Check, Clock, Film, Loader2, Pause, X } from 'lucide-react';
import { cn } from 'cn';
import type { RunDetailDto } from '@reelcraft/shared';
import { formatElapsed } from '@/lib/format-elapsed';
import type { RunView, StageView } from './run-phases.logic';

export const RESULT_KEY = '__result';

function StageIcon({ stage }: { stage: StageView }) {
  const base = 'flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3';
  switch (stage.state) {
    case 'done':
      return (
        <span className={cn(base, 'bg-ok-soft text-ok')}>
          <Check />
        </span>
      );
    case 'running':
      return (
        <span className={cn(base, 'bg-run-soft text-run ring-3 ring-run-soft')}>
          <Loader2 className="animate-spin" />
        </span>
      );
    case 'failed':
      return (
        <span className={cn(base, 'bg-bad-soft text-bad')}>
          <X />
        </span>
      );
    case 'waiting':
      return (
        <span className={cn(base, 'bg-wait-soft text-wait')}>
          <Clock />
        </span>
      );
    case 'paused':
      return (
        <span className={cn(base, 'bg-run-soft text-run')}>
          <Pause />
        </span>
      );
    case 'stale':
      return <span className={cn(base, 'border-[1.5px] border-dashed border-wait')} />;
    case 'next':
      return <span className={cn(base, 'border-[1.5px] border-run/60')} />;
    default:
      return <span className={cn(base, 'border-[1.5px] border-dashed border-line-strong')} />;
  }
}

function trailing(stage: StageView): { text: string; tone?: string | undefined } | null {
  const e = stage.execution;
  if (e.isIterating && e.itemCount && ['running', 'failed', 'paused'].includes(stage.state))
    return {
      text: `${e.availableActions?.completedItems ?? 0} / ${e.itemCount}`,
      tone:
        stage.state === 'running' ? 'text-run' : stage.state === 'failed' ? 'text-bad' : undefined,
    };
  if (stage.state === 'next') return { text: 'next' };
  if (stage.state === 'waiting') return { text: 'you', tone: 'text-wait' };
  if (stage.state === 'skipped') return { text: 'skipped' };
  if (e.startedAt && e.endedAt) return { text: formatElapsed(e.startedAt, e.endedAt) };
  if (e.startedAt && stage.state === 'running') return { text: formatElapsed(e.startedAt, null) };
  return null;
}

/** Every stage of the run, in order and grouped by phase, with its state at a glance. */
export function RunStageList({
  run,
  view,
  selectedKey,
  onSelect,
}: {
  run: Pick<RunDetailDto, 'definition' | 'finalVideo' | 'state'>;
  view: RunView;
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}) {
  const groupOf = new Map((run.definition?.graph ?? []).map((s) => [s.key, s.group?.trim()]));
  const blocked = view.failed.length > 0;
  let lastGroup: string | undefined;
  return (
    <nav aria-label="Stages" className="pb-3">
      {run.finalVideo ? (
        <button
          type="button"
          onClick={() => onSelect(RESULT_KEY)}
          aria-current={selectedKey === RESULT_KEY ? 'true' : undefined}
          className={cn(
            'mx-1.5 mt-2.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-medium text-foreground hover:bg-surface-2',
            selectedKey === RESULT_KEY && 'bg-surface-3',
          )}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-ok-soft text-ok">
            <Film className="size-3" />
          </span>
          Final video
        </button>
      ) : null}
      {view.stages.map((stage) => {
        const group = groupOf.get(stage.key);
        const header = group && group !== lastGroup ? group : null;
        if (group) lastGroup = group;
        const info = trailing(stage);
        const selected = stage.key === selectedKey;
        const dim = blocked && ['pending', 'next', 'stale'].includes(stage.state);
        const e = stage.execution;
        return (
          <div key={stage.key}>
            {header ? (
              <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-1.5 text-xs font-semibold text-faint">
                {header}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(stage.key)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'mx-1.5 my-px flex w-[calc(100%-0.75rem)] flex-wrap items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground',
                selected && 'bg-surface-3 text-foreground',
                dim && 'opacity-60',
              )}
            >
              <StageIcon stage={stage} />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  (stage.state === 'running' || selected) && 'font-medium text-foreground',
                )}
              >
                {stage.number} · {stage.name}
              </span>
              {info ? (
                <span className={cn('font-mono text-[11px] text-faint', info.tone)}>
                  {info.text}
                </span>
              ) : null}
              {stage.state === 'running' && e.isIterating && e.itemCount ? (
                <span className="ml-[30px] h-1 w-[calc(100%-30px)] overflow-hidden rounded-full bg-background">
                  <span
                    className="block h-full bg-run"
                    style={{
                      width: `${Math.round(((e.availableActions?.completedItems ?? 0) / e.itemCount) * 100)}%`,
                    }}
                  />
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
