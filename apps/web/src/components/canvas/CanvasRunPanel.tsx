import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, History, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { InputDef, RunDetailDto, StageDef } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ApprovalReviewSheet } from '@/components/runs/approval-review-sheet';
import { ArtifactPreview } from '@/components/runs/artifact-preview';
import { StageOutputSheet } from '@/components/runs/stage-output-sheet';
import { StageAttemptsSheet } from '@/components/runs/stage-attempts-sheet';
import { RunLaunchDialog } from '@/pages/RunLaunchDialog';
import { buildRunAllDto, buildRunStageDto } from '@/pages/canvas-run.logic';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { runStateTone, stageExecutionStateTone, toneDotClassName } from '@/lib/status';
import { formatRunDuration } from '@/pages/runs-page.logic';

/** One reused-stage badge per row, driven by the `stage.reused` event
 * `run-seed.ts`'s `copyReusedStages` writes — fetched lazily per run since
 * it's log data, not part of `RunDetailDto`. */
function useReusedStageKeys(runId: string | undefined, stageKeys: string[]) {
  const query = useQuery({
    queryKey: ['run-reused-stages', runId, stageKeys],
    queryFn: async () => {
      const results = await Promise.all(
        stageKeys.map(async (key) => {
          const logs = await api.listStageLogs(runId!, key);
          return logs.some((event) => event.type === 'stage.reused') ? key : null;
        }),
      );
      return new Set(results.filter((key): key is string => key !== null));
    },
    enabled: Boolean(runId) && stageKeys.length > 0,
  });
  return query.data ?? new Set<string>();
}

export function CanvasRunPanel({
  channelId,
  blueprintId,
  graph,
  inputs,
  budgetCapUsd,
  run,
  onSwitchRun,
  prepareRunnableVersion,
}: {
  channelId: string;
  blueprintId: string;
  graph: StageDef[];
  inputs: InputDef[];
  budgetCapUsd: number;
  run: RunDetailDto | undefined;
  onSwitchRun: (runId: string) => void;
  prepareRunnableVersion: () => Promise<string>;
}) {
  const queryClient = useQueryClient();
  const [outputSheetKey, setOutputSheetKey] = useState<string | null>(null);
  const [attemptsSheetKey, setAttemptsSheetKey] = useState<string | null>(null);
  const [approvalStageKey, setApprovalStageKey] = useState<string | null>(null);
  const reusedKeys = useReusedStageKeys(run?.id, run?.stageExecutions.map((e) => e.stageKey) ?? []);
  const stageLabel = (stageKey: string) => graph.find((s) => s.key === stageKey)?.label ?? stageKey;

  const runStage = useMutation({
    mutationFn: async (stageKey: string) => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      const created = await api.createRun(buildRunStageDto(run, blueprintVersionId, stageKey));
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: (runId) => {
      onSwitchRun(runId);
      void queryClient.invalidateQueries({ queryKey: ['runs', { blueprintId }] });
    },
    onError: (error) => toast.error(describeRunActionError(error, 'Could not start the stage.')),
  });

  const runAll = useMutation({
    mutationFn: async () => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      const created = await api.createRun(buildRunAllDto(run, blueprintVersionId));
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: (runId) => {
      onSwitchRun(runId);
      void queryClient.invalidateQueries({ queryKey: ['runs', { blueprintId }] });
    },
    onError: (error) => toast.error(describeRunActionError(error, 'Could not start the run.')),
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', run?.id] }),
  });
  const pause = useMutation({
    mutationFn: () => api.pauseRun(run!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', run?.id] }),
  });
  const resume = useMutation({
    mutationFn: () => api.resumeRun(run!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', run?.id] }),
  });

  const lastStageKey = graph.at(-1)?.key;
  const lastExecution = run?.stageExecutions.find((e) => e.stageKey === lastStageKey);
  const blueprintOutput = useQuery({
    queryKey: ['stage-output', run?.id, lastStageKey],
    queryFn: () => api.getStageOutput(run!.id, lastStageKey!),
    enabled: Boolean(run?.id && lastStageKey && lastExecution?.outputArtifactId),
  });

  if (!run) {
    return (
      <div className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 lg:w-90 lg:shrink-0">
        <h2 className="text-sm font-medium">Run</h2>
        <p className="text-sm text-muted-foreground">
          No runs yet. Start one to run stages independently and monitor them here.
        </p>
        <RunLaunchDialog
          channelId={channelId}
          inputs={inputs}
          defaultBudgetCapUsd={budgetCapUsd}
          prepareVersion={prepareRunnableVersion}
          onLaunched={onSwitchRun}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-lg border bg-card p-4 lg:w-90 lg:shrink-0">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/runs/${run.id}`}
            className="font-mono text-xs text-muted-foreground hover:underline"
          >
            #{run.id.slice(-6)}
          </Link>
          <StatusBadge tone={runStateTone(run.state)} label={run.state} />
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>${Number(run.spentUsd).toFixed(2)}</span>
          <span>·</span>
          <span>{formatRunDuration(run.startedAt, run.endedAt)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => runAll.mutate()} disabled={runAll.isPending}>
          {runAll.isPending ? 'Starting…' : 'Run all'}
        </Button>
        {isRunActionAllowed('cancel', run.state) && (
          <Button size="sm" variant="outline" onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        )}
        {isRunActionAllowed('pause', run.state) && (
          <Button size="sm" variant="outline" onClick={() => pause.mutate()}>
            Pause
          </Button>
        )}
        {isRunActionAllowed('resume', run.state) && (
          <Button size="sm" variant="outline" onClick={() => resume.mutate()}>
            Resume
          </Button>
        )}
      </div>

      <div className="flex flex-col divide-y rounded-md border">
        {graph.map((stage) => {
          const execution = run.stageExecutions.find((e) => e.stageKey === stage.key);
          const tone = execution ? stageExecutionStateTone(execution.state) : 'neutral';
          // No per-stage cancel API: stopping a running stage cancels its run.
          const stoppable =
            execution?.state === 'running' && isRunActionAllowed('cancel', run.state);
          return (
            <div key={stage.key} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                title={stoppable ? 'Cancel' : 'Run'}
                aria-label={stoppable ? 'Cancel' : 'Run'}
                disabled={stoppable ? cancel.isPending : runStage.isPending}
                onClick={() => (stoppable ? cancel.mutate() : runStage.mutate(stage.key))}
              >
                {stoppable ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
              <span className={`size-2 shrink-0 rounded-full ${toneDotClassName[tone]}`} />
              <span className="min-w-0 flex-1 truncate text-xs" title={stage.key}>
                {stage.label}
              </span>
              {reusedKeys.has(stage.key) && (
                <Badge variant="outline" className="text-[10px] tracking-wide uppercase">
                  Reused
                </Badge>
              )}
              {run.state === 'PAUSED_APPROVAL' && run.cursorStageKey === stage.key && (
                <Button size="sm" onClick={() => setApprovalStageKey(stage.key)}>
                  Review output
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                title="View output"
                aria-label="View output"
                onClick={() => setOutputSheetKey(stage.key)}
              >
                <Eye className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                title="Attempts"
                aria-label="Attempts"
                onClick={() => setAttemptsSheetKey(stage.key)}
              >
                <History className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Blueprint output
        </h3>
        {!lastExecution?.outputArtifactId ? (
          <p className="text-sm text-muted-foreground">Last stage hasn&apos;t run yet.</p>
        ) : blueprintOutput.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          blueprintOutput.data?.items[0] && (
            <ArtifactPreview artifact={blueprintOutput.data.items[0].artifact} />
          )
        )}
      </div>

      <StageOutputSheet
        runId={run.id}
        stageKey={outputSheetKey}
        stageLabel={outputSheetKey && stageLabel(outputSheetKey)}
        stageRunning={run.stageExecutions.some(
          (e) => e.stageKey === outputSheetKey && e.state === 'running',
        )}
        open={outputSheetKey !== null}
        onOpenChange={(open) => !open && setOutputSheetKey(null)}
      />
      <StageAttemptsSheet
        runId={run.id}
        stageKey={attemptsSheetKey}
        stageLabel={attemptsSheetKey && stageLabel(attemptsSheetKey)}
        stageRunning={run.stageExecutions.some(
          (e) => e.stageKey === attemptsSheetKey && e.state === 'running',
        )}
        open={attemptsSheetKey !== null}
        onOpenChange={(open) => !open && setAttemptsSheetKey(null)}
      />
      <ApprovalReviewSheet
        runId={run.id}
        stageKey={approvalStageKey}
        open={approvalStageKey !== null}
        onOpenChange={(open) => !open && setApprovalStageKey(null)}
      />
    </div>
  );
}
