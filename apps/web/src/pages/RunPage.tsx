import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, Play } from 'lucide-react';
import { cn } from 'cn';
import { api } from '@/api/client';
import { useRunExecutionActions } from '@/hooks/useRunExecutionActions';
import { useRun } from '../hooks/useRun';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { RunExecutionToolbar, ExecutionPlanDialog } from '@/components/runs/execution-controls';
import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { RaiseBudgetDialog } from '@/components/runs/raise-budget-dialog';
import { SubmitFormInputDialog } from '@/components/runs/submit-form-input-dialog';
import { ProductionRunDialog } from '@/components/runs/production-run-dialog';
import { RunMemorySheet } from '@/components/runs/run-memory-sheet';
import { StageDetail } from '@/components/runs/stage-drawer';
import { RunSegments } from '@/components/runs/run-segments';
import { RESULT_KEY, RunStageList } from '@/components/runs/run-stage-list';
import { RunAssistantPanel } from '@/components/runs/run-assistant-panel';
import { buildRunView } from '@/components/runs/run-phases.logic';
import { focusStage, runNow } from '@/components/runs/run-now.logic';
import { AssistantDock, loadDockOpen, saveDockOpen } from '@/components/assistant/assistant-dock';
import { runStateTone, toneTextClassName } from '@/lib/status';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { quotaPauseMessage } from '@/lib/quota-pause';
import { formatCapUsd } from '@/lib/format-cap';
import { formatElapsed, formatUsd } from '@/lib/format-elapsed';
import { runHandle, runStateSentence } from '@/lib/run-buckets';
import { isApprovalStillOpen } from './approval-review.logic';
import { deepLinkTarget } from './run-deep-link.logic';

/** Re-renders every second while `active`, for clocks that count up. */
function useTick(active: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
}

/** A run: what it is doing now on top, every stage on the left, the chosen stage in the middle,
 * and the assistant on the right. */
export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: run, isLoading, isFetching } = useRun(runId);
  const [reviewStageKey, setReviewStageKey] = useState<string | null>(null);
  const [formInputStageKey, setFormInputStageKey] = useState<string | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [raiseBudgetOpen, setRaiseBudgetOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(() => loadDockOpen('run'));

  const blueprint = useQuery({
    queryKey: ['blueprint', run?.blueprintId],
    queryFn: () => api.getBlueprint(run!.blueprintId!),
    enabled: !!run?.blueprintId,
  });
  const channel = useQuery({
    queryKey: ['channel', run?.channelId],
    queryFn: () => api.getChannel(run!.channelId),
    enabled: !!run?.channelId,
  });

  useEffect(() => {
    if (reviewStageKey && run && !isApprovalStillOpen(reviewStageKey, run)) {
      setReviewStageKey(null);
    }
  }, [reviewStageKey, run]);

  // A notification links here with `?review=<stage>` or `?input=<stage>`. Open what is still
  // waiting, then drop the param so a refresh or a later visit does not reopen it.
  useEffect(() => {
    const review = searchParams.get('review');
    const input = searchParams.get('input');
    // Wait for the fetch to settle: a cached copy from an earlier visit can be out of date, and
    // would make a link to a waiting stage look already answered.
    if (!run || isFetching || (!review && !input)) return;
    const target = deepLinkTarget({ review, input }, run);
    if (target.review) setReviewStageKey(target.review);
    if (target.input) setFormInputStageKey(target.input);
    setSearchParams({}, { replace: true });
  }, [run, isFetching, searchParams, setSearchParams]);

  const actions = useRunExecutionActions({ run });
  const view = useMemo(() => (run ? buildRunView(run) : null), [run]);
  const live = !!run && !run.endedAt && ['RUNNING', 'CREATED', 'PAUSING'].includes(run.state);
  useTick(live);

  if (isLoading || !run || !view) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-2 w-full" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="w-72" />
          <Skeleton className="flex-1" />
        </div>
      </div>
    );
  }

  const selectedKey =
    pickedKey ?? (run.state === 'COMPLETED' && run.finalVideo ? RESULT_KEY : focusStage(view)?.key);
  const selectedStage = view.stages.find((s) => s.key === selectedKey);
  const now = runNow(run, view);
  const counted = view.stages.filter((s) => s.state !== 'skipped');
  const done = counted.filter((s) => s.state === 'done').length;
  const budgetCapUsd = Number(run.budgetCapUsd);
  const canRaiseBudget = isRunActionAllowed('raise_budget', run.state);
  const title = blueprint.data?.name ?? 'Run';
  const setDock = (open: boolean) => {
    setDockOpen(open);
    saveDockOpen('run', open);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ApprovalReviewSheet
        runId={run.id}
        stageKey={reviewStageKey}
        open={reviewStageKey !== null}
        onOpenChange={(open) => !open && setReviewStageKey(null)}
      />
      <RaiseBudgetDialog
        runId={run.id}
        currentBudgetCapUsd={budgetCapUsd}
        budgetBlock={run.budgetBlock}
        stageLabel={
          run.stageExecutions.find((se) => se.stageKey === run.budgetBlock?.stageKey)?.label
        }
        open={raiseBudgetOpen}
        onOpenChange={setRaiseBudgetOpen}
      />
      <ExecutionPlanDialog actions={actions} />
      <SubmitFormInputDialog
        runId={run.id}
        stageKey={formInputStageKey}
        stageLabel={run.stageExecutions.find((se) => se.stageKey === formInputStageKey)?.label}
        output={run.stageExecutions.find((se) => se.stageKey === formInputStageKey)?.output}
        open={formInputStageKey !== null}
        onOpenChange={(open) => !open && setFormInputStageKey(null)}
      />
      <RunMemorySheet
        runId={run.id}
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        onOpenStage={setPickedKey}
        stageOrder={view.stages.map((s) => s.key)}
        labelOf={(key) => view.stages.find((s) => s.key === key)?.label ?? key}
      />

      <header className="flex flex-col gap-3 border-b px-5 pt-3.5 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              <Link to="/runs" className="hover:text-foreground">
                Runs
              </Link>
              {channel.data ? ` / ${channel.data.name}` : ''}
              {run.draft ? ' / test run' : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-semibold" title={run.id}>
                {title}{' '}
                <span className="font-mono text-sm font-normal text-faint">
                  {runHandle(run.id)}
                </span>
              </h1>
              <StatusBadge tone={runStateTone(run.state)} label={runStateSentence(run.state)} />
            </div>
          </div>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setMemoryOpen(true)}>
            <Brain /> Memory
          </Button>
          {run.blueprintId && (
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/blueprints/${run.blueprintId}/build${run.draft ? `?run=${run.id}` : ''}`}>
                Open blueprint
              </Link>
            </Button>
          )}
          <RunExecutionToolbar
            run={run}
            actions={actions}
            start={
              run.draft || !run.blueprintId ? null : (
                <ProductionRunDialog
                  blueprintId={run.blueprintId}
                  channelId={run.channelId}
                  previous={run}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      <Play />
                      Run again
                    </Button>
                  )}
                />
              )
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-[320px] flex-1 items-center gap-2.5">
            {now.tone === 'running' ? (
              <Loader2 className="size-4 animate-spin text-run" aria-hidden />
            ) : (
              <span className={cn('size-2 rounded-full bg-current', toneTextClassName[now.tone])} />
            )}
            <span className="text-[15px]">
              <b className="font-semibold">
                {run.state === 'FAILED' ? 'Stopped:' : run.state === 'COMPLETED' ? 'Done:' : 'Now:'}
              </b>{' '}
              {now.text}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-[13px]">
            <span>
              <span className="text-faint">Stages</span>{' '}
              <b className="font-mono font-medium">
                {done} / {counted.length}
              </b>
            </span>
            <span>
              <span className="text-faint">Time</span>{' '}
              <b className="font-mono font-medium">{formatElapsed(run.startedAt, run.endedAt)}</b>
            </span>
            <span>
              <span className="text-faint">Cost</span>{' '}
              <b className="font-mono font-medium">{formatUsd(Number(run.spentUsd))}</b>{' '}
              <span className="text-faint">
                {budgetCapUsd > 0 ? `of ${formatCapUsd(budgetCapUsd)}` : 'no limit'}
              </span>
            </span>
            {canRaiseBudget ? (
              <Button size="xs" variant="outline" onClick={() => setRaiseBudgetOpen(true)}>
                Raise budget
              </Button>
            ) : null}
          </div>
        </div>
        <RunSegments view={view} />
        {run.state === 'PAUSED_QUOTA' ? (
          <p className="text-sm text-wait">
            {quotaPauseMessage(run.resumeAt, (when) => when.toLocaleString())}
          </p>
        ) : null}
        {run.budgetBlock ? (
          <p className="text-sm text-wait">
            {run.budgetBlock.scope === 'stage'
              ? `Paused: stage "${
                  run.stageExecutions.find((se) => se.stageKey === run.budgetBlock!.stageKey)
                    ?.label ?? run.budgetBlock.stageKey
                }" reached its own Stage cap ($${Number(run.budgetBlock.stageCapUsd ?? 0).toFixed(2)}). Raise it to continue.`
              : 'Paused: the next step would go over the run budget. Raise the budget to continue.'}
          </p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r bg-card max-md:hidden">
          <RunStageList run={run} view={view} selectedKey={selectedKey} onSelect={setPickedKey} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {selectedKey === RESULT_KEY && run.finalVideo ? (
            <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-6 pt-5 pb-10">
              <p className="text-xs text-faint">The finished video</p>
              <h2 className="text-[22px] font-semibold tracking-[-0.015em]">Final video</h2>
              <video
                controls
                className="max-h-[70vh] w-full rounded-[14px] border bg-black"
                src={`/api/blobs/${run.finalVideo.blobId}`}
                {...(run.finalVideo.posterBlobId && {
                  poster: `/api/blobs/${run.finalVideo.posterBlobId}`,
                })}
              />
            </div>
          ) : selectedStage ? (
            <StageDetail
              run={run}
              view={view}
              stage={selectedStage}
              actions={actions}
              onOpenStage={setPickedKey}
              onReview={setReviewStageKey}
              onProvideInput={setFormInputStageKey}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">This run has no stages.</p>
          )}
        </main>
        <AssistantDock
          open={dockOpen}
          onOpenChange={setDock}
          width="w-[340px]"
          badge={
            <span className="inline-flex h-5 items-center rounded-full bg-acc-soft px-2 text-xs font-medium text-acc">
              This run
            </span>
          }
        >
          <RunAssistantPanel run={run} view={view} selectedStage={selectedStage?.key} />
        </AssistantDock>
      </div>
    </div>
  );
}
