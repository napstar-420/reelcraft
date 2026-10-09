import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Eye,
  FileText,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import type { RetryScope } from '@reelcraft/shared';
import { api } from '../api/client';
import { useRun } from '../hooks/useRun';
import { formatRunDuration } from './runs-page.logic';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { runStateTone, stageExecutionStateTone } from '@/lib/status';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { RaiseBudgetDialog } from '@/components/runs/raise-budget-dialog';
import { StageRetryDialog } from '@/components/runs/stage-retry-dialog';
import { SubmitFormInputDialog } from '@/components/runs/submit-form-input-dialog';
import { StageAttemptsSheet } from '@/components/runs/stage-attempts-sheet';
import { StageOutputSheet } from '@/components/runs/stage-output-sheet';
import { RunMemoryCard } from '@/components/runs/run-memory-card';
import { isApprovalStillOpen } from './approval-review.logic';
import { quotaPauseMessage } from '@/lib/quota-pause';
import { formatCapUsd } from '@/lib/format-cap';

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading } = useRun(runId);
  const queryClient = useQueryClient();
  const [reviewStageKey, setReviewStageKey] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ stageKey: string; scope: RetryScope } | null>(null);
  const [formInputStageKey, setFormInputStageKey] = useState<string | null>(null);
  const [attemptsStageKey, setAttemptsStageKey] = useState<string | null>(null);
  const [outputStageKey, setOutputStageKey] = useState<string | null>(null);
  const [raiseBudgetOpen, setRaiseBudgetOpen] = useState(false);

  useEffect(() => {
    if (reviewStageKey && run && !isApprovalStillOpen(reviewStageKey, run)) {
      setReviewStageKey(null);
    }
  }, [reviewStageKey, run]);

  const cancelRun = useMutation({
    mutationFn: () => api.cancelRun(runId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const pauseRun = useMutation({
    mutationFn: () => api.pauseRun(runId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const resumeRun = useMutation({
    mutationFn: () => api.resumeRun(runId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const rerun = useMutation({
    mutationFn: async () => {
      const created = await api.createRun({
        channelId: run!.channelId,
        blueprintVersionId: run!.blueprintVersionId,
        budgetCapUsd: Number(run!.budgetCapUsd),
        inputs: run!.inputs,
        // Roles come from the blueprint version: starting the new run takes a
        // fresh snapshot of each character as it is now.
        roleBindings: {},
        rerunStageKeys: [],
      });
      return api.startRun(created.id);
    },
    onSuccess: (created) => navigate(`/runs/${created.id}`),
  });

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

  const canCancel = isRunActionAllowed('cancel', run.state);
  const canPause = isRunActionAllowed('pause', run.state);
  const canResume = isRunActionAllowed('resume', run.state);
  const canRaiseBudget = isRunActionAllowed('raise_budget', run.state);
  const canRetry = isRunActionAllowed('retry', run.state);
  const isStageRunning = (stageKey: string | null) =>
    run.stageExecutions.some((se) => se.stageKey === stageKey && se.state === 'running');
  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.state);
  const canRerun = isTerminal;
  const usesCharacter = Object.keys(run.roleBindings).length > 0;

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
      <StageRetryDialog
        runId={run.id}
        stageKey={retry?.stageKey ?? null}
        scope={retry?.scope ?? 'dependents'}
        open={retry !== null}
        onOpenChange={(open) => !open && setRetry(null)}
      />
      <SubmitFormInputDialog
        runId={run.id}
        stageKey={formInputStageKey}
        stageLabel={run.stageExecutions.find((se) => se.stageKey === formInputStageKey)?.label}
        output={run.stageExecutions.find((se) => se.stageKey === formInputStageKey)?.output}
        open={formInputStageKey !== null}
        onOpenChange={(open) => !open && setFormInputStageKey(null)}
      />
      <StageAttemptsSheet
        runId={run.id}
        stageKey={attemptsStageKey}
        open={attemptsStageKey !== null}
        onOpenChange={(open) => !open && setAttemptsStageKey(null)}
      />
      <StageOutputSheet
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
          </div>
          <div className="flex items-center gap-2">
            {canRerun ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={rerun.isPending}>
                    {rerun.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Rerun
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Start a new run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A new run starts from the beginning with the same blueprint version, inputs
                      and budget cap.
                      {usesCharacter
                        ? ' It uses the character as it is now, including any changes made since this run.'
                        : ''}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => rerun.mutate()}>
                      Start new run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {canPause ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pauseRun.isPending}
                onClick={() => pauseRun.mutate()}
              >
                {pauseRun.isPending ? <Loader2 className="animate-spin" /> : <Pause />}
                Pause
              </Button>
            ) : null}
            {canResume ? (
              <Button
                size="sm"
                variant="outline"
                disabled={resumeRun.isPending}
                onClick={() => resumeRun.mutate()}
              >
                {resumeRun.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                Resume
              </Button>
            ) : null}
            {canCancel ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={cancelRun.isPending}>
                    <Ban /> Cancel run
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This stops the run permanently and can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep running</AlertDialogCancel>
                    <AlertDialogAction onClick={() => cancelRun.mutate()}>
                      Yes, cancel run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </div>

        {cancelRun.isError || pauseRun.isError || resumeRun.isError || rerun.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>
              {describeRunActionError(
                cancelRun.error ?? pauseRun.error ?? resumeRun.error ?? rerun.error,
                'The action could not be completed.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex max-w-md items-center gap-2">
            <Progress value={spentPct} className="flex-1" />
            {canRaiseBudget ? (
              <Button size="sm" variant="ghost" onClick={() => setRaiseBudgetOpen(true)}>
                <Wallet /> Raise budget
              </Button>
            ) : null}
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
                <StatusBadge tone={stageExecutionStateTone(se.state)} label={se.state} />
                <span className="text-sm text-muted-foreground">
                  {se.attemptCount} attempt{se.attemptCount === 1 ? '' : 's'}
                </span>
                {se.startedAt && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatRunDuration(se.startedAt, se.endedAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {run.state === 'PAUSED_APPROVAL' && run.cursorStageKey === se.stageKey ? (
                  <Button size="sm" onClick={() => setReviewStageKey(se.stageKey)}>
                    <Eye /> Review output
                  </Button>
                ) : null}
                {se.interaction === 'form' &&
                run.state === 'PAUSED_INPUT' &&
                run.cursorStageKey === se.stageKey ? (
                  <Button size="sm" onClick={() => setFormInputStageKey(se.stageKey)}>
                    Provide input
                  </Button>
                ) : null}
                {se.interaction === 'timeline_editor' && se.state === 'awaiting_input' ? (
                  <Button size="sm" asChild>
                    <Link to={`/runs/${run.id}/stages/${se.stageKey}/edit`}>Open editor</Link>
                  </Button>
                ) : null}
                {canRetry && ['passed', 'failed', 'stale'].includes(se.state) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline">
                        <RefreshCw /> {se.state === 'passed' ? 'Re-run' : 'Retry'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setRetry({ stageKey: se.stageKey, scope: 'dependents' })}
                      >
                        With stages that use its output
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setRetry({ stageKey: se.stageKey, scope: 'stage' })}
                      >
                        Only this stage
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setRetry({ stageKey: se.stageKey, scope: 'downstream' })}
                      >
                        This and all later stages
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
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
