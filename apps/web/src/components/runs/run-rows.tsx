import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ChevronRight, Clock, Loader2, Sparkles, Wallet } from 'lucide-react';
import type { RunDetailDto, RunSummaryDto } from '@reelcraft/shared';
import { cn } from 'cn';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { askInBlueprint, fixFailedStagePrompt } from '@/lib/assistant-handoff';
import { formatElapsed, formatUsd } from '@/lib/format-elapsed';
import { runHandle, runStateSentence } from '@/lib/run-buckets';
import { runStateTone } from '@/lib/status';
import { buildRunView, type RunView } from './run-phases.logic';
import { runNow } from './run-now.logic';
import { RunSegments } from './run-segments';
import { failureReason } from './stage-drawer.logic';

/** The full runs behind some list rows, for what they are doing right now. Shares the `run`
 * cache (and its live updates) with the run page. */
export function useRunDetails(ids: string[]): Map<string, { run: RunDetailDto; view: RunView }> {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ['run', id], queryFn: () => api.getRun(id) })),
  });
  return useMemo(() => {
    const map = new Map<string, { run: RunDetailDto; view: RunView }>();
    results.forEach((r) => {
      if (r.data) map.set(r.data.id, { run: r.data, view: buildRunView(r.data) });
    });
    return map;
  }, [results.map((r) => r.dataUpdatedAt).join()]);
}

const ROW = 'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2';

/** A run that needs a person, with the one action that answers it. */
export function AttentionRow({
  summary,
  detail,
}: {
  summary: RunSummaryDto;
  detail: { run: RunDetailDto; view: RunView } | undefined;
}) {
  const navigate = useNavigate();
  const view = detail?.view;
  const failed = view?.failed[0];
  const waiting = view?.waiting[0];
  const ago = formatDistanceToNow(new Date(summary.endedAt ?? summary.startedAt), {
    addSuffix: true,
  });
  const where = (
    <>
      {summary.blueprintName} <span className="font-mono">{runHandle(summary.id)}</span>
    </>
  );

  let icon = <AlertTriangle className="size-[15px]" />;
  let tone = 'bg-bad-soft text-bad';
  let title: string = runStateSentence(summary.state);
  let subtitle: React.ReactNode = (
    <>
      {where} · {ago}
    </>
  );
  let actions: React.ReactNode = (
    <Button size="sm" variant="outline" asChild>
      <Link to={`/runs/${summary.id}`}>Open</Link>
    </Button>
  );

  if (summary.state === 'FAILED') {
    const reason = failed ? failureReason(failed.execution.failure) : null;
    title = failed ? `${failed.name} failed` : 'The run failed';
    subtitle = (
      <>
        {where} · {reason ?? 'open it to see why'} · {ago}
      </>
    );
    actions = (
      <>
        {summary.blueprintId && failed ? (
          <Button
            size="sm"
            variant="accent"
            onClick={() => {
              const handoff = askInBlueprint(
                summary.blueprintId,
                fixFailedStagePrompt({
                  runHandle: runHandle(summary.id),
                  stageLabel: failed.label,
                  reason,
                }),
              );
              navigate(handoff.to, { state: handoff.state });
            }}
          >
            <Sparkles /> Fix with assistant
          </Button>
        ) : null}
        {actions}
      </>
    );
  } else if (summary.state === 'PAUSED_APPROVAL' || summary.state === 'PAUSED_INPUT') {
    icon = <Clock className="size-[15px]" />;
    tone = 'bg-wait-soft text-wait';
    const approval = waiting?.execution.waiting === 'approval';
    title = waiting
      ? approval
        ? `${waiting.name} is ready for your review`
        : `${waiting.name} needs your input`
      : runStateSentence(summary.state);
    subtitle = (
      <>
        {where}
        {waiting ? ` · stage ${waiting.number}` : ''} · waiting {ago.replace(' ago', '')}
      </>
    );
    if (waiting) {
      const editor = waiting.execution.interaction === 'timeline_editor';
      const to = editor
        ? `/runs/${summary.id}/stages/${waiting.key}/edit`
        : `/runs/${summary.id}?${approval ? 'review' : 'input'}=${encodeURIComponent(waiting.key)}`;
      actions = (
        <Button size="sm" asChild>
          <Link to={to}>{approval ? 'Review' : editor ? 'Open editor' : 'Provide input'}</Link>
        </Button>
      );
    }
  } else if (summary.state === 'PAUSED_BUDGET') {
    icon = <Wallet className="size-[15px]" />;
    tone = 'bg-wait-soft text-wait';
    actions = (
      <Button size="sm" asChild>
        <Link to={`/runs/${summary.id}`}>Raise budget</Link>
      </Button>
    );
  }

  return (
    <div className={ROW}>
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[9px]', tone)}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-[13px] text-faint">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

/** A run that is still going: its progress and the stage it is on. */
export function ActiveRow({
  summary,
  detail,
  trailing,
}: {
  summary: RunSummaryDto;
  detail: { run: RunDetailDto; view: RunView } | undefined;
  trailing?: React.ReactNode;
}) {
  const now = detail ? runNow(detail.run, detail.view) : null;
  return (
    <div className={ROW}>
      <Link to={`/runs/${summary.id}`} className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{summary.blueprintName}</span>
          <span className="font-mono text-xs text-faint">{runHandle(summary.id)}</span>
          {summary.draft || summary.dryRun ? (
            <span className="text-xs text-faint">{summary.draft ? 'test run' : 'dry run'}</span>
          ) : null}
          <span className="flex-1" />
          <span className="font-mono text-xs text-faint">
            {formatElapsed(summary.startedAt, summary.endedAt)} · {formatUsd(summary.spentUsd)}
          </span>
        </span>
        {detail ? (
          <RunSegments view={detail.view} size="sm" />
        ) : (
          <span className="h-[5px] rounded-full bg-surface-3" />
        )}
        <span className="flex items-center gap-2 text-[13px]">
          <StatusBadge tone={runStateTone(summary.state)} label={runStateSentence(summary.state)} />
          <span className="truncate text-muted-foreground">
            {now ? now.text : <Loader2 className="size-3.5 animate-spin" />}
          </span>
        </span>
      </Link>
      {trailing}
      <ChevronRight className="size-[15px] shrink-0 text-faint" aria-hidden />
    </div>
  );
}
