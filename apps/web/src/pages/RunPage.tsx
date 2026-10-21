import { useRunExecutionActions } from '@/hooks/useRunExecutionActions';
import {
  RunExecutionToolbar,
  StageExecutionControls,
  ExecutionPlanDialog,
} from '@/components/runs/execution-controls';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Eye, FileText, History, Play, Wallet } from 'lucide-react';

import { useRun } from '../hooks/useRun';
import { formatRunDuration } from './runs-page.logic';

import { StatusBadge } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { runStateTone, stageExecutionStateTone } from '@/lib/status';
import { displayStageState, runHeadline, stageStatusLabel } from '@/lib/run-actions';
import { canAnswerWaits, isRunActionAllowed } from '@/lib/run-action-policy';

import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { RaiseBudgetDialog } from '@/components/runs/raise-budget-dialog';

import { SubmitFormInputDialog } from '@/components/runs/submit-form-input-dialog';
import { StageAttemptsSheet } from '@/components/runs/stage-attempts-sheet';
import { StageOutputSheet } from '@/components/runs/stage-output-sheet';
import { RunMemoryCard } from '@/components/runs/run-memory-card';
import { ProductionRunDialog } from '@/components/runs/production-run-dialog';
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
  const [attemptsStageKey, setAttemptsStageKey] = useState<string | null>(null);
  const [outputStageKey, setOutputStageKey] = useState<string | null>(null);
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

  if (isLoading || !run) {
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
  const isStageRunning = (stageKey: string | null) =>
    run.stageExecutions.some((se) => se.stageKey === stageKey && se.state === 'running');

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
      <StageAttemptsSheet
        actions={run.availableActions?.busy ? undefined : actions}
        runId={run.id}
        stageKey={attemptsStageKey}
        open={attemptsStageKey !== null}
        onOpenChange={(open) => !open && setAttemptsStageKey(null)}
      />
      <StageOutputSheet
        actions={run.availableActions?.busy ? undefined : actions}
        runId={run.id}
        stageKey={outputStageKey}
        stageRunning={isStageRunning(outputStageKey)}
        open={outputStageKey !== null}
        onOpenChange={(open) => !open && setOutputStageKey(null)}
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

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Stages</h2>
        <div className="flex flex-col gap-3">
          {run.stageExecutions.map((se) => (
            <Card key={se.id} className="flex-row items-center justify-between gap-4 px-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex flex-col">
                  <span className="font-medium">{se.label}</span>
                  {se.label !== se.stageKey ? (
                    <span className="font-mono text-xs text-muted-foreground">{se.stageKey}</span>
                  ) : null}
                </span>
                <StatusBadge
                  tone={stageExecutionStateTone(displayStageState(se, run))}
                  label={stageStatusLabel(displayStageState(se, run))}
                />
                <span className="text-sm text-muted-foreground">
                  {se.attemptCount} attempt{se.attemptCount === 1 ? '' : 's'}
                </span>
                {se.startedAt && (se.endedAt || displayStageState(se, run) === 'running') && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatRunDuration(se.startedAt, se.endedAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isApprovalStillOpen(se.stageKey, run) ? (
                  <Button size="sm" onClick={() => setReviewStageKey(se.stageKey)}>
                    <Eye /> Review output
                  </Button>
                ) : null}
                {se.interaction === 'form' &&
                canAnswerWaits(run.state) &&
                se.waiting === 'input' ? (
                  <Button size="sm" onClick={() => setFormInputStageKey(se.stageKey)}>
                    Provide input
                  </Button>
                ) : null}
                {se.interaction === 'timeline_editor' && se.state === 'awaiting_input' ? (
                  <Button size="sm" asChild>
                    <Link to={`/runs/${run.id}/stages/${se.stageKey}/edit`}>Open editor</Link>
                  </Button>
                ) : null}
                <StageExecutionControls
                  available={se.availableActions}
                  busy={run.availableActions?.busy ?? true}
                  pending={actions.runStage.isPending}
                  onAction={(request) =>
                    actions.runStage.mutate({ stageKey: se.stageKey, ...request })
                  }
                />
                {se.outputArtifactId !== null || (se.isIterating && se.state !== 'pending') ? (
                  <Button size="sm" variant="ghost" onClick={() => setOutputStageKey(se.stageKey)}>
                    <FileText /> View output
                  </Button>
                ) : null}
                {se.attemptCount > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAttemptsStageKey(se.stageKey)}
                  >
                    <History /> Attempts
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Memory</h2>
        <RunMemoryCard run={run} onOpenStage={setOutputStageKey} />
      </div>
    </section>
  );
}
