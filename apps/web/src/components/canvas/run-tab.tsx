import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, History, Info, Pause, Play, Square } from 'lucide-react';
import { cn } from 'cn';
import type { InputDef, RunDetailDto, StageDef } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/ui/status-badge';
import { ArtifactPreview } from '@/components/runs/artifact-preview';
import { RunMemoryCard } from '@/components/runs/run-memory-card';
import type { CanvasRunActions } from '@/hooks/useCanvasRunActions';
import { runStageTitle, upstreamBlocker } from '@/components/canvas/stage-card.logic';
import { RunLaunchDialog } from '@/pages/RunLaunchDialog';
import { formatRunDuration } from '@/pages/runs-page.logic';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { runStateTone, stageExecutionStateTone, toneDotClassName } from '@/lib/status';
import { formatCapUsd } from '@/lib/format-cap';

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

function Section({
  title,
  aside,
  children,
  last,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={cn('flex flex-col gap-2.5 p-4', !last && 'border-b')}>
      <h3 className="flex items-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        {aside ? (
          <span className="ml-auto font-medium tracking-normal normal-case">{aside}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** The Run tab: the active run's state and spend, Run all / Pause / Cancel,
 * every stage with its output and attempts, the blueprint's final output and
 * the run's memory. Per-stage play buttons also live on the canvas cards. */
export function RunTab({
  channelId,
  inputs,
  graph,
  budgetCapUsd,
  run,
  actions,
  selectedKey,
  onSelectStage,
  isDirty,
  onSwitchRun,
  prepareRunnableVersion,
}: {
  channelId: string;
  inputs: InputDef[];
  graph: StageDef[];
  budgetCapUsd: number;
  run: RunDetailDto | undefined;
  actions: CanvasRunActions;
  selectedKey: string | null;
  onSelectStage: (stageKey: string) => void;
  isDirty: boolean;
  onSwitchRun: (runId: string) => void;
  prepareRunnableVersion: () => Promise<string>;
}) {
  const reusedKeys = useReusedStageKeys(run?.id, run?.stageExecutions.map((e) => e.stageKey) ?? []);

  const lastStageKey = graph.at(-1)?.key;
  const lastExecution = run?.stageExecutions.find((e) => e.stageKey === lastStageKey);
  const blueprintOutput = useQuery({
    queryKey: ['stage-output', run?.id, lastStageKey],
    queryFn: () => api.getStageOutput(run!.id, lastStageKey!),
    enabled: Boolean(run?.id && lastStageKey && lastExecution?.outputArtifactId),
  });

  if (!run) {
    return (
      <div className="flex flex-col items-center gap-2 px-7 py-12 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Play className="size-5" />
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold">No runs yet</h3>
        <p className="max-w-72 text-sm text-muted-foreground">
          Save the blueprint, then run it. To run just the first stages, pick one under Run up to.
          After that, each stage shows its status on the canvas and you can re-run a single stage
          from there.
        </p>
        <div className="mt-2">
          <RunLaunchDialog
            channelId={channelId}
            inputs={inputs}
            stages={graph}
            defaultBudgetCapUsd={budgetCapUsd}
            prepareVersion={prepareRunnableVersion}
            onLaunched={onSwitchRun}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Dry runs use the fake provider and cost nothing.
        </p>
      </div>
    );
  }

  const labelOf = actions.stageLabel;
  const spent = Number(run.spentUsd);
  const cap = Number(run.budgetCapUsd);
  const percent = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;

  return (
    <div className="flex flex-col">
      <section className="flex flex-col gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <Link
            to={`/runs/${run.id}`}
            className="font-mono text-sm font-medium hover:underline"
            title="Open the run page"
          >
            #{run.id.slice(-6)}
          </Link>
          <StatusBadge tone={runStateTone(run.state)} label={run.state} />
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {formatRunDuration(run.startedAt, run.endedAt)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Progress value={percent} aria-label="Spend against the run cap" />
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>${spent.toFixed(2)} spent</span>
            <span>cap {formatCapUsd(cap)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => actions.runAll.mutate()}
            disabled={actions.runAll.isPending}
          >
            <Play />
            {actions.runAll.isPending ? 'Starting…' : 'Run all'}
          </Button>
          {isRunActionAllowed('pause', run.state) && (
            <Button size="sm" variant="outline" onClick={() => actions.pause.mutate()}>
              <Pause />
              Pause
            </Button>
          )}
          {isRunActionAllowed('resume', run.state) && (
            <Button size="sm" variant="outline" onClick={() => actions.resume.mutate()}>
              <Play />
              Resume
            </Button>
          )}
          {isRunActionAllowed('cancel', run.state) && (
            <Button size="sm" variant="outline" onClick={() => actions.setConfirmCancel(true)}>
              Cancel run
            </Button>
          )}
        </div>
        {isDirty && (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            You have unsaved changes. Stage runs use a draft snapshot and don&apos;t create a
            version.
          </p>
        )}
      </section>

      <Section title="Stages">
        <div className="-mx-2 flex flex-col">
          {graph.map((stage) => {
            const execution = run.stageExecutions.find((e) => e.stageKey === stage.key);
            const tone = execution ? stageExecutionStateTone(execution.state) : 'neutral';
            // No per-stage cancel API: stopping a running stage cancels its run.
            const stoppable =
              execution?.state === 'running' && isRunActionAllowed('cancel', run.state);
            return (
              <div
                key={stage.key}
                className={cn(
                  'flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3 text-sm hover:bg-muted',
                  selectedKey === stage.key && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title={
                    stoppable
                      ? 'Cancel run'
                      : runStageTitle(upstreamBlocker(run, graph, stage.key), labelOf)
                  }
                  aria-label={stoppable ? 'Cancel run' : 'Run this stage'}
                  disabled={stoppable ? actions.cancel.isPending : actions.runStage.isPending}
                  onClick={() =>
                    stoppable
                      ? actions.setConfirmCancel(true)
                      : actions.runStage.mutate({ stageKey: stage.key })
                  }
                >
                  {stoppable ? <Square /> : <Play />}
                </Button>
                <span className={cn('size-2 shrink-0 rounded-full', toneDotClassName[tone])} />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm"
                  title={stage.key}
                  onClick={() => onSelectStage(stage.key)}
                >
                  {stage.label}
                </button>
                {reusedKeys.has(stage.key) && (
                  <Badge variant="outline" className="text-[10px] tracking-wide uppercase">
                    Reused
                  </Badge>
                )}
                {run.state === 'PAUSED_APPROVAL' && run.cursorStageKey === stage.key && (
                  <Button size="xs" onClick={() => actions.setApprovalStageKey(stage.key)}>
                    Review output
                  </Button>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="View output"
                  aria-label="View output"
                  onClick={() => actions.setOutputSheetKey(stage.key)}
                >
                  <Eye />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Attempts"
                  aria-label="Attempts"
                  onClick={() => actions.setAttemptsSheetKey(stage.key)}
                >
                  <History />
                </Button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Blueprint output">
        {!lastExecution?.outputArtifactId ? (
          <p className="text-sm text-muted-foreground">Last stage hasn&apos;t run yet.</p>
        ) : blueprintOutput.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          blueprintOutput.data?.items[0] && (
            <ArtifactPreview artifact={blueprintOutput.data.items[0].artifact} />
          )
        )}
      </Section>

      <Section title="Memory" last>
        <RunMemoryCard run={run} onOpenStage={actions.setOutputSheetKey} />
      </Section>
    </div>
  );
}
