import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, ListVideo, Loader2, Pause, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import type { RunState, RunSummaryDto } from '@reelcraft/shared';
import { cn } from 'cn';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ActiveRow, AttentionRow, useRunDetails } from '@/components/runs/run-rows';
import { CountPill, EmptyState, Page, PageHeader, Section } from '@/components/shell/page';
import { useRunBuckets } from '@/hooks/useRunBuckets';
import { formatElapsed, formatUsd } from '@/lib/format-elapsed';
import { runHandle, runStateSentence } from '@/lib/run-buckets';
import { runStateTone, toneTextClassName } from '@/lib/status';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import {
  RUNS_PAGE_LIMIT,
  RUN_STATES,
  parseRunsListSearchParams,
  runsListSearchParams,
  type RunsListFilters,
} from './runs-page.logic';
import { FilterChip } from './BlueprintsPage';

const ALL = '__all__';
const CLEARED_FILTERS: RunsListFilters = {
  channelId: undefined,
  blueprintId: undefined,
  state: undefined,
  includeDryRuns: false,
  page: 0,
};
const STATE_CHIPS: Array<{ state: RunState | undefined; label: string }> = [
  { state: undefined, label: 'All' },
  { state: 'RUNNING', label: 'Running' },
  { state: 'FAILED', label: 'Failed' },
  { state: 'COMPLETED', label: 'Done' },
  { state: 'CANCELLED', label: 'Stopped' },
];

/** Runs: what needs you and what is running on top, then every run with filters. Inside a
 * channel (`channelId`) it shows only that channel's runs and no page header. */
export function RunsPage({ channelId: fixedChannelId }: { channelId?: string } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = {
    ...parseRunsListSearchParams(searchParams),
    ...(fixedChannelId && { channelId: fixedChannelId }),
  };
  const [cancelTarget, setCancelTarget] = useState<RunSummaryDto | null>(null);
  const buckets = useRunBuckets();
  const inScope = (r: RunSummaryDto) => !fixedChannelId || r.channelId === fixedChannelId;
  const needsYou = buckets.needsYou.filter(inScope);
  const active = buckets.active.filter(inScope);
  // Every rendered row needs its run: cap only the attention list, never the active one.
  const details = useRunDetails([...needsYou.slice(0, 12), ...active].map((r) => r.id));

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.listChannels(),
    enabled: !fixedChannelId,
  });
  const blueprints = useQuery({
    queryKey: ['blueprints', filters.channelId],
    queryFn: () => api.listBlueprints(filters.channelId!),
    enabled: !!filters.channelId,
  });

  const offset = filters.page * RUNS_PAGE_LIMIT;
  const runs = useQuery({
    queryKey: [
      'runs',
      filters.channelId,
      filters.blueprintId,
      filters.state,
      filters.includeDryRuns,
      offset,
    ],
    queryFn: () =>
      api.listRuns({
        channelId: filters.channelId,
        blueprintId: filters.blueprintId,
        state: filters.state,
        includeDryRuns: filters.includeDryRuns,
        includeDrafts: filters.includeDryRuns,
        limit: RUNS_PAGE_LIMIT,
        offset,
      }),
  });

  function onRowActionSettled(runId: string) {
    void queryClient.invalidateQueries({ queryKey: ['runs'] });
    void queryClient.invalidateQueries({ queryKey: ['run', runId] });
  }
  function onRowActionError(error: unknown) {
    toast.error(describeRunActionError(error, 'The action could not be completed.'));
  }
  const pauseRun = useMutation({
    mutationFn: (runId: string) => api.pauseRun(runId),
    onSuccess: (_data, runId) => onRowActionSettled(runId),
    onError: onRowActionError,
  });
  const resumeRun = useMutation({
    mutationFn: (runId: string) => api.resumeRun(runId),
    onSuccess: (_data, runId) => onRowActionSettled(runId),
    onError: onRowActionError,
  });
  const cancelRun = useMutation({
    mutationFn: (runId: string) => api.cancelRun(runId),
    onSuccess: (_data, runId) => {
      onRowActionSettled(runId);
      setCancelTarget(null);
    },
    onError: onRowActionError,
  });

  function updateFilters(patch: Partial<RunsListFilters>) {
    setSearchParams(runsListSearchParams({ ...filters, page: 0, ...patch }), { replace: true });
  }
  const hasActiveFilters =
    (!fixedChannelId && !!filters.channelId) ||
    !!filters.blueprintId ||
    !!filters.state ||
    filters.includeDryRuns;
  const total = runs.data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + RUNS_PAGE_LIMIT, total);

  function rowControls(run: RunSummaryDto) {
    const busy =
      (pauseRun.isPending && pauseRun.variables === run.id) ||
      (resumeRun.isPending && resumeRun.variables === run.id) ||
      (cancelRun.isPending && cancelRun.variables === run.id);
    return (
      <span className="flex shrink-0 gap-1">
        {isRunActionAllowed('pause', run.state) && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Pause run"
            title="Pause run"
            disabled={busy}
            onClick={() => pauseRun.mutate(run.id)}
          >
            {pauseRun.isPending && pauseRun.variables === run.id ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Pause />
            )}
          </Button>
        )}
        {isRunActionAllowed('resume', run.state) && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Continue run"
            title="Continue run"
            disabled={busy}
            onClick={() => resumeRun.mutate(run.id)}
          >
            {resumeRun.isPending && resumeRun.variables === run.id ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play />
            )}
          </Button>
        )}
        {isRunActionAllowed('cancel', run.state) && run.state !== 'FAILED' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stop run"
            title="Stop run"
            disabled={busy}
            onClick={() => setCancelTarget(run)}
          >
            <Square />
          </Button>
        )}
      </span>
    );
  }

  const body = (
    <>
      {needsYou.length ? (
        <Section title="Needs you" badge={<CountPill count={needsYou.length} tone="wait" />}>
          {needsYou.slice(0, 12).map((r) => (
            <AttentionRow key={r.id} summary={r} detail={details.get(r.id)} />
          ))}
        </Section>
      ) : null}
      {active.length ? (
        <Section title="Running" badge={<CountPill count={active.length} tone="run" />}>
          {active.map((r) => (
            <ActiveRow
              key={r.id}
              summary={r}
              detail={details.get(r.id)}
              trailing={rowControls(r)}
            />
          ))}
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        {STATE_CHIPS.map((chip) => (
          <FilterChip
            key={chip.label}
            active={filters.state === chip.state}
            onClick={() => updateFilters({ state: chip.state })}
          >
            {chip.label}
          </FilterChip>
        ))}
        <Select
          value={
            filters.state && !STATE_CHIPS.some((c) => c.state === filters.state)
              ? filters.state
              : ALL
          }
          onValueChange={(v) => updateFilters({ state: v === ALL ? undefined : (v as RunState) })}
        >
          <SelectTrigger size="sm" className="h-8 rounded-full" aria-label="Other states">
            <SelectValue placeholder="More states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>More states</SelectItem>
            {RUN_STATES.filter((s) => !STATE_CHIPS.some((c) => c.state === s)).map((s) => (
              <SelectItem key={s} value={s}>
                {runStateSentence(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="mx-1 h-5 w-px bg-line-strong" />
        {!fixedChannelId && (
          <Select
            value={filters.channelId ?? ALL}
            onValueChange={(v) =>
              updateFilters({ channelId: v === ALL ? undefined : v, blueprintId: undefined })
            }
          >
            <SelectTrigger size="sm" className="h-8 rounded-full" aria-label="Channel">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All channels</SelectItem>
              {channels.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={filters.blueprintId ?? ALL}
          onValueChange={(v) => updateFilters({ blueprintId: v === ALL ? undefined : v })}
          disabled={!filters.channelId}
        >
          <SelectTrigger size="sm" className="h-8 rounded-full" aria-label="Blueprint">
            <SelectValue placeholder="All blueprints" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All blueprints</SelectItem>
            {blueprints.data?.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] text-faint">
          <Switch
            checked={filters.includeDryRuns}
            onCheckedChange={(checked) => updateFilters({ includeDryRuns: checked })}
          />
          Show test runs
        </label>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSearchParams(runsListSearchParams(CLEARED_FILTERS), { replace: true })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      <Section
        title="All runs"
        action={
          total ? (
            <span className="text-[13px] text-faint">
              {showingFrom}–{showingTo} of {total}
            </span>
          ) : null
        }
      >
        {runs.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : runs.data?.items.length ? (
          runs.data.items.map((run) => (
            <div
              key={run.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/runs/${run.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/runs/${run.id}`);
                }
              }}
              className="grid cursor-pointer grid-cols-[52px_minmax(0,2.2fr)_minmax(0,2fr)_auto_72px_64px_16px] items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none max-md:grid-cols-[52px_minmax(0,1fr)_16px]"
            >
              <RunThumb run={run} />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {run.blueprintName}{' '}
                  <span className="font-mono text-xs font-normal text-faint">
                    {runHandle(run.id)}
                  </span>
                  {run.draft || run.dryRun ? (
                    <span className="ml-2 text-xs font-normal text-faint">
                      {run.draft ? 'test run' : 'dry run'}
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-faint">
                  {fixedChannelId ? `v${run.blueprintVersion}` : run.channelName} ·{' '}
                  {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                </span>
              </span>
              <span className="min-w-0 max-md:hidden">
                <StatusBadge tone={runStateTone(run.state)} label={runStateSentence(run.state)} />
              </span>
              <span
                className="max-md:hidden"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {rowControls(run)}
              </span>
              <span className="font-mono text-xs text-faint max-md:hidden">
                {formatElapsed(run.startedAt, run.endedAt)}
              </span>
              <span className="font-mono text-xs text-faint max-md:hidden">
                {formatUsd(run.spentUsd)}
              </span>
              <ChevronRight className="size-[15px] text-faint" aria-hidden />
            </div>
          ))
        ) : (
          <EmptyState
            icon={<ListVideo />}
            action={
              hasActiveFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSearchParams(runsListSearchParams(CLEARED_FILTERS), { replace: true })
                  }
                >
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" asChild>
                  <Link to="/blueprints">
                    <Play /> Start a run
                  </Link>
                </Button>
              )
            }
          >
            {hasActiveFilters ? 'No runs match these filters.' : 'No runs yet.'}
          </EmptyState>
        )}
      </Section>

      {total > RUNS_PAGE_LIMIT ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page === 0}
            onClick={() => updateFilters({ page: filters.page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + RUNS_PAGE_LIMIT >= total}
            onClick={() => updateFilters({ page: filters.page + 1 })}
          >
            Next
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Stop run {cancelTarget ? runHandle(cancelTarget.id) : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everything finished so far is kept, and you can continue from here later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-bad text-white hover:bg-bad/85"
              disabled={cancelRun.isPending}
              onClick={() => cancelTarget && cancelRun.mutate(cancelTarget.id)}
            >
              Stop run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (fixedChannelId) return <div className="flex flex-col gap-5">{body}</div>;
  return (
    <Page>
      <PageHeader
        title="Runs"
        description="Every time a blueprint makes a video. Open one to see each stage as it happens."
        actions={
          <Button asChild>
            <Link to="/blueprints">
              <Play /> Start a run
            </Link>
          </Button>
        }
      />
      {body}
    </Page>
  );
}

function RunThumb({ run }: { run: RunSummaryDto }) {
  const tone = runStateTone(run.state);
  if (run.posterBlobId)
    return (
      <img
        src={`/api/blobs/${run.posterBlobId}`}
        alt=""
        className="size-[52px] rounded-[9px] object-cover"
      />
    );
  return (
    <span
      className={cn(
        'flex size-[52px] items-center justify-center rounded-[9px] bg-surface-3',
        toneTextClassName[tone],
      )}
    >
      <span className="size-2 rounded-full bg-current" />
    </span>
  );
}
