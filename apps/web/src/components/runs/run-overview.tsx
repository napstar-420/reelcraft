import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { toneDotClassName } from '@/lib/status';
import { formatRunDuration } from '@/pages/runs-page.logic';
import type { RunDetailDto } from '@reelcraft/shared';
import { StageAnswerButtons } from './stage-answer-buttons';
import { VIEW_LABEL, viewTone, type RunView, type StageView } from './run-phases.logic';

const SEGMENTS = [
  ['done', 'bg-ok'],
  ['running', 'bg-run'],
  ['waiting', 'bg-wait'],
  ['failed', 'bg-destructive'],
] as const;

/** One bar for the whole run: how many stages are done, running, waiting for you or failed. */
export function StageProgress({ view }: { view: RunView }) {
  const counted = view.stages.filter((s) => s.state !== 'skipped');
  const done = counted.filter((s) => s.state === 'done').length;
  return (
    <div className="flex items-center gap-4">
      <div
        className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Stages done"
        aria-valuemin={0}
        aria-valuemax={counted.length}
        aria-valuenow={done}
      >
        {SEGMENTS.map(([state, color]) => {
          const count = counted.filter((s) => s.state === state).length;
          return count ? (
            <span
              key={state}
              className={color}
              style={{ width: `${(count / counted.length) * 100}%` }}
            />
          ) : null;
        })}
      </div>
      <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
        <b className="text-foreground">
          {done} of {counted.length}
        </b>{' '}
        stages done
      </span>
    </div>
  );
}

function StageChip({ stage, onOpen }: { stage: StageView; onOpen: (key: string) => void }) {
  return (
    <Button size="sm" variant="outline" onClick={() => onOpen(stage.key)}>
      {stage.number} · {stage.name}
    </Button>
  );
}

/** The few things that need a person: stages that failed and stages waiting for a review or input. */
export function RunAttention({
  run,
  view,
  onOpenStage,
  onReview,
  onProvideInput,
}: {
  run: Pick<RunDetailDto, 'id' | 'state' | 'stageExecutions'>;
  view: RunView;
  onOpenStage: (key: string) => void;
  onReview: (key: string) => void;
  onProvideInput: (key: string) => void;
}) {
  if (!view.failed.length && !view.waiting.length) return null;
  return (
    <Card
      className={cn(
        'gap-2 px-4 py-3',
        view.waiting.length && !view.failed.length && 'bg-wait-soft ring-wait/40',
      )}
    >
      {view.failed.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="error" label={`${view.failed.length} failed`} />
          {view.failed.map((s) => (
            <StageChip key={s.key} stage={s} onOpen={onOpenStage} />
          ))}
        </div>
      ) : null}
      {view.waiting.map((s) => (
        <div key={s.key} className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning" label="Waiting for you" />
          <span className="text-sm">
            {s.number} · {s.name}
          </span>
          <StageAnswerButtons
            run={run}
            stage={s.execution}
            onReview={onReview}
            onProvideInput={onProvideInput}
          />
        </div>
      ))}
    </Card>
  );
}

function pausedDetail(stage: StageView): string {
  const { completedItems, totalItems } = stage.execution.availableActions ?? {};
  return totalItems ? `Paused · ${completedItems ?? 0}/${totalItems} items` : 'Paused';
}

function StageRow({
  stage,
  detail,
  onOpen,
}: {
  stage: StageView;
  detail?: string | undefined;
  onOpen: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(stage.key)}
      className="flex w-full items-center gap-2 border-t py-1.5 text-left text-sm first:border-t-0 hover:bg-muted/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          stage.state === 'next'
            ? 'border border-dashed border-violet-400'
            : toneDotClassName[viewTone(stage.state)],
        )}
      />
      <span className="min-w-0 flex-1 truncate">
        {stage.number} · {stage.name}
      </span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </button>
  );
}

function Panel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <Card className="gap-1 px-4 py-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children.length ? children : <p className="py-1 text-sm text-muted-foreground">{empty}</p>}
    </Card>
  );
}

/** What is running now, what starts next and what finished last: the three questions at a glance. */
export function RunNowNext({
  run,
  view,
  onOpenStage,
}: {
  run: Pick<RunDetailDto, 'state'>;
  view: RunView;
  onOpenStage: (key: string) => void;
}) {
  const complete = run.state === 'COMPLETED';
  const stuck = view.failed.length > 0;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Panel
        title="Running now"
        empty={complete ? 'Nothing: the run is complete.' : 'Nothing is running.'}
      >
        {view.running.map((s) => (
          <StageRow
            key={s.key}
            stage={s}
            detail={
              s.execution.startedAt
                ? formatRunDuration(s.execution.startedAt, new Date().toISOString())
                : undefined
            }
            onOpen={onOpenStage}
          />
        ))}
      </Panel>
      <Panel
        title="Up next"
        empty={
          complete
            ? 'Nothing left.'
            : stuck
              ? 'Blocked: fix the failed stage, then press Continue.'
              : 'Nothing queued.'
        }
      >
        {[...view.paused, ...view.next].slice(0, 4).map((s) => (
          <StageRow
            key={s.key}
            stage={s}
            detail={s.state === 'paused' ? pausedDetail(s) : undefined}
            onOpen={onOpenStage}
          />
        ))}
      </Panel>
      <Panel title="Finished recently" empty="Nothing finished yet.">
        {view.recent.map((s) => (
          <StageRow key={s.key} stage={s} detail={VIEW_LABEL.done} onOpen={onOpenStage} />
        ))}
      </Panel>
    </div>
  );
}
