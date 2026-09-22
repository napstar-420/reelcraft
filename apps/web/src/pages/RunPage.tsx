import { Link, useParams } from 'react-router-dom';
import { useRun } from '../hooks/useRun';
import { StatusBadge } from '@/components/ui/status-badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { runStateTone, stageExecutionStateTone } from '@/lib/status';

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading } = useRun(runId);

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

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight" title={run.id}>
            Run {run.id}
          </h1>
          <StatusBadge tone={runStateTone(run.state)} label={run.state} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Progress value={spentPct} className="max-w-md" />
          <p className="text-sm text-muted-foreground">
            ${spentUsd.toFixed(2)} spent of ${budgetCapUsd.toFixed(2)} budget
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Stages</h2>
        <div className="flex flex-col gap-3">
          {run.stageExecutions.map((se) => (
            <Card key={se.id} className="flex-row items-center justify-between gap-4 px-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{se.stageKey}</span>
                <StatusBadge tone={stageExecutionStateTone(se.state)} label={se.state} />
                <span className="text-sm text-muted-foreground">
                  {se.attemptCount} attempt{se.attemptCount === 1 ? '' : 's'}
                </span>
              </div>
              {se.interaction === 'timeline_editor' && se.state === 'awaiting_input' ? (
                <Button size="sm" asChild>
                  <Link to={`/runs/${run.id}/stages/${se.stageKey}/edit`}>Open editor</Link>
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
