import { useRunExecutionActions } from '@/hooks/useRunExecutionActions';
import { RunExecutionToolbar, ExecutionPlanDialog } from '@/components/runs/execution-controls';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Brain, Play, Wallet } from 'lucide-react';

import { useRun } from '../hooks/useRun';

import { StatusBadge } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { runStateTone } from '@/lib/status';
import { runHeadline } from '@/lib/run-actions';
import { isRunActionAllowed } from '@/lib/run-action-policy';

import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { RaiseBudgetDialog } from '@/components/runs/raise-budget-dialog';

import { SubmitFormInputDialog } from '@/components/runs/submit-form-input-dialog';
import { ProductionRunDialog } from '@/components/runs/production-run-dialog';
import { RunAttention, RunNowNext, StageProgress } from '@/components/runs/run-overview';
import { RunGraph } from '@/components/runs/run-graph';
import { RunMemorySheet } from '@/components/runs/run-memory-sheet';
import { StageDrawer } from '@/components/runs/stage-drawer';
import { buildRunView } from '@/components/runs/run-phases.logic';
import { isApprovalStillOpen } from './approval-review.logic';
import { deepLinkTarget } from './run-deep-link.logic';
import { quotaPauseMessage } from '@/lib/quota-pause';
import { formatCapUsd } from '@/lib/format-cap';

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: run, isLoading, isFetching } = useRun(runId);
  const [reviewStageKey, setReviewStageKey] = useState<string | null>(null);
  const [formInputStageKey, setFormInputStageKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [raiseBudgetOpen, setRaiseBudgetOpen] = useState(false);

  useEffect(() => {
    if (reviewStageKey && run && !isApprovalStillOpen(reviewStageKey, run)) {
      setReviewStageKey(null);
    }
  }, [reviewStageKey, run]);

  // A notification links here with `?review=<stage>` or `?input=<stage>`. Open
  // what is still waiting, then drop the param so a refresh or a later visit
  // does not reopen it.
  useEffect(() => {
    const review = searchParams.get('review');
    const input = searchParams.get('input');
    // Wait for the fetch to settle: a cached copy from an earlier visit can be
    // out of date, and would make a link to a waiting stage look already answered.
    if (!run || isFetching || (!review && !input)) return;
    const target = deepLinkTarget({ review, input }, run);
    if (target.review) setReviewStageKey(target.review);
    if (target.input) setFormInputStageKey(target.input);
    setSearchParams({}, { replace: true });
  }, [run, isFetching, searchParams, setSearchParams]);

  const actions = useRunExecutionActions({ run });
  const view = useMemo(() => (run ? buildRunView(run) : null), [run]);

  if (isLoading || !run || !view) {
    return (
      <section className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3 w-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </section>
    );
  }

  const spentUsd = Number(run.spentUsd);
  const budgetCapUsd = Number(run.budgetCapUsd);
  const spentPct = budgetCapUsd > 0 ? Math.min(100, (spentUsd / budgetCapUsd) * 100) : 0;

  const canRaiseBudget = isRunActionAllowed('raise_budget', run.state);

  return (
    <section className="flex flex-col gap-6">
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight" title={run.id}>
              Run {run.id}
            </h1>
            <StatusBadge tone={runStateTone(run.state)} label={run.state} />
            {runHeadline(run) ? (
              <span
                className={
                  run.state === 'FAILED'
                    ? 'text-sm text-destructive'
                    : 'text-sm text-muted-foreground'
                }
              >
                {runHeadline(run)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setMemoryOpen(true)}>
              <Brain /> Memory
            </Button>
            {run.blueprintId && (
              <Button size="sm" variant="ghost" asChild>
                <Link
                  to={`/blueprints/${run.blueprintId}/build${run.draft ? `?run=${run.id}` : ''}`}
                >
                  Open canvas
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
        </div>

        <StageProgress view={view} />

        <div className="flex flex-col gap-1.5">
          <div className="flex max-w-md items-center gap-2">
            <Progress value={spentPct} className="flex-1" />
            {canRaiseBudget && (
              <Button size="sm" variant="ghost" onClick={() => setRaiseBudgetOpen(true)}>
                <Wallet /> Raise budget
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            ${spentUsd.toFixed(2)} spent
            {budgetCapUsd > 0 ? ` of ${formatCapUsd(budgetCapUsd)} budget` : ' (no budget limit)'}
          </p>
          {run.state === 'PAUSED_QUOTA' ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {quotaPauseMessage(run.resumeAt, (when) => when.toLocaleString())}
            </p>
          ) : null}
          {run.budgetBlock ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {run.budgetBlock.scope === 'stage'
                ? `Paused: stage "${
                    run.stageExecutions.find((se) => se.stageKey === run.budgetBlock!.stageKey)
                      ?.label ?? run.budgetBlock.stageKey
                  }" reached its own Stage cap ($${Number(run.budgetBlock.stageCapUsd ?? 0).toFixed(2)}). Raise it to continue.`
                : 'Paused: the next step would go over the run budget. Raise the budget to continue.'}
            </p>
          ) : null}
        </div>
      </div>

      <RunAttention
        run={run}
        view={view}
        onOpenStage={setSelectedKey}
        onReview={setReviewStageKey}
        onProvideInput={setFormInputStageKey}
      />

      {run.finalVideo ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Final video</h2>
          <video
            controls
            className="max-w-2xl rounded-lg border bg-black"
            src={`/api/blobs/${run.finalVideo.blobId}`}
            {...(run.finalVideo.posterBlobId && {
              poster: `/api/blobs/${run.finalVideo.posterBlobId}`,
            })}
          />
        </div>
      ) : null}

      <RunNowNext run={run} view={view} onOpenStage={setSelectedKey} />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Pipeline</h2>
        <Card className="px-4">
          <RunGraph view={view} selectedKey={selectedKey} onOpenStage={setSelectedKey} />
        </Card>
      </div>

      <StageDrawer
        run={run}
        view={view}
        stageKey={selectedKey}
        actions={actions}
        onClose={() => setSelectedKey(null)}
        onOpenStage={setSelectedKey}
        onReview={setReviewStageKey}
        onProvideInput={setFormInputStageKey}
      />
      <RunMemorySheet
        runId={run.id}
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        onOpenStage={setSelectedKey}
        labelOf={(key) => view.stages.find((s) => s.key === key)?.label ?? key}
      />
    </section>
  );
}
