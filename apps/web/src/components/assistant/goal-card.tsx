import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { cn } from 'cn';
import type { AssistantItemDto, GoalPayload } from '@reelcraft/shared';
import { runHandle } from '@/lib/run-buckets';
import { payloadOf } from './assistant.logic';

const OUTCOME: Record<GoalPayload['state'], { label: string; tone: string }> = {
  met: { label: 'Goal met', tone: 'text-ok' },
  limit: { label: 'Stopped at the limit', tone: 'text-wait' },
  stopped: { label: 'Not met', tone: 'text-muted-foreground' },
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The report of a goal the assistant worked toward: every run it made, and what they cost. */
export function GoalCard({ item }: { item: AssistantItemDto }) {
  const goal = payloadOf<GoalPayload>(item);
  const outcome = OUTCOME[goal.state];
  return (
    <div className="rounded-[12px] border border-line-strong bg-card p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Target className="size-3.5" />
        Goal for “{goal.blueprintName}”
      </p>
      <p className="text-[13px] font-semibold">{goal.goal}</p>
      <p className={cn('mt-0.5 text-xs font-medium', outcome.tone)}>
        {outcome.label} · {goal.attempts} of {goal.maxRuns} runs · {usd(goal.spentUsd)} of{' '}
        {usd(goal.maxSpendUsd)}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {goal.summary}
      </p>
      {goal.runs.length > 0 && (
        <ol className="mt-2 space-y-0.5 border-t pt-2 text-xs" aria-label="Runs">
          {goal.runs.map((run, i) => (
            <li key={run.runId} className="flex items-center gap-2">
              <span className="w-5 text-muted-foreground">{i + 1}.</span>
              <Link
                to={`/runs/${run.runId}`}
                className="font-mono text-[11px] underline-offset-2 hover:underline"
              >
                {runHandle(run.runId)}
              </Link>
              <span className="text-muted-foreground">
                {run.state.toLowerCase().replace(/_/g, ' ')}
              </span>
              <span className="flex-1" />
              <span className="text-muted-foreground">
                {run.free ? 'free test' : usd(run.spentUsd)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
