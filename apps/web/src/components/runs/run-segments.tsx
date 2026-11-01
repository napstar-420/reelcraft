import { cn } from 'cn';
import type { RunView, ViewState } from './run-phases.logic';

const SEGMENT: Partial<Record<ViewState, string>> = {
  done: 'bg-ok',
  running: 'bg-run',
  waiting: 'bg-wait',
  failed: 'bg-bad',
  paused: 'bg-run/40',
  stale: 'bg-wait/40',
};

/** One segment per stage, coloured by its state: the run's progress at a glance. */
export function RunSegments({
  view,
  className,
  size = 'md',
}: {
  view: RunView;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const stages = view.stages.filter((s) => s.state !== 'skipped');
  const done = stages.filter((s) => s.state === 'done').length;
  return (
    <div
      role="img"
      aria-label={`${done} of ${stages.length} stages done`}
      className={cn(
        'flex overflow-hidden rounded-full',
        size === 'sm' ? 'h-[5px] gap-0.5' : 'h-2 gap-[3px]',
        className,
      )}
    >
      {stages.map((s) => (
        <span
          key={s.key}
          title={`${s.number} · ${s.name}`}
          className={cn('h-full flex-1 rounded-[2px]', SEGMENT[s.state] ?? 'bg-surface-3')}
        />
      ))}
    </div>
  );
}
