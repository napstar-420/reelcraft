import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Wrench } from 'lucide-react';
import { cn } from 'cn';
import type { AssistantItemDto, RepairPayload, RepairPhase, RepairState } from '@reelcraft/shared';
import { runHandle } from '@/lib/run-buckets';
import { payloadOf } from './assistant.logic';

const PHASE: Record<RepairPhase, string> = {
  preparing: 'Copying the source',
  fixing: 'Fixing the code',
  verifying: 'Running the checks',
  publishing: 'Opening a pull request',
  applying: 'Applying the fix',
};

const OUTCOME: Record<Exclude<RepairState, 'working'>, { label: string; tone: string }> = {
  applied: { label: 'Fixed and applied', tone: 'text-ok' },
  pr_only: { label: 'Fixed, not applied', tone: 'text-wait' },
  failed: { label: 'Not fixed', tone: 'text-destructive' },
};

/** An engine repair: a coding agent fixing Reelcraft itself for a failed stage. */
export function RepairCard({ item }: { item: AssistantItemDto }) {
  const repair = payloadOf<RepairPayload>(item);
  const state = (item.state ?? 'working') as RepairState;
  return (
    <div className="rounded-[12px] border border-line-strong bg-card p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Wrench className="size-3.5" />
        Engine repair ·{' '}
        <Link
          to={`/runs/${repair.runId}`}
          className="font-mono text-[11px] underline-offset-2 hover:underline"
        >
          {runHandle(repair.runId)}
        </Link>{' '}
        · {repair.stageKey}
      </p>
      {state === 'working' ? (
        <p className="flex items-center gap-1.5 text-[13px] font-medium" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          {PHASE[repair.phase]}…
          <span className="font-normal text-muted-foreground">
            {repair.agent} · {repair.model}
          </span>
        </p>
      ) : (
        <p className={cn('text-[13px] font-semibold', OUTCOME[state].tone)}>
          {OUTCOME[state].label}
        </p>
      )}
      {state === 'pr_only' && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your checkout has its own changes in the same files: merge the pull request or apply the
          branch yourself.
        </p>
      )}
      <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {repair.summary ?? repair.diagnosis}
      </p>
      {repair.error && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">
          {repair.error}
        </pre>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs">
        <span className="font-mono text-[11px] text-muted-foreground">{repair.branch}</span>
        {repair.prUrl && (
          <a
            href={repair.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            Pull request <ExternalLink className="size-3" />
          </a>
        )}
        {repair.prError && (
          <span className="text-wait" title={repair.prError}>
            No pull request
          </span>
        )}
      </div>
      {repair.diff && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {repair.changedFiles?.length ?? 0} file
            {repair.changedFiles?.length === 1 ? '' : 's'} changed
          </summary>
          <pre className="mt-1.5 max-h-80 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
            {repair.diff}
          </pre>
        </details>
      )}
    </div>
  );
}
