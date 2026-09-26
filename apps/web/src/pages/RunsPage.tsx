import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ListVideo, Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { RunState, RunSummaryDto } from '@reelcraft/shared';
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { runStateTone, formatStatusLabel } from '@/lib/status';
import { isRunActionAllowed } from '@/lib/run-action-policy';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import {
  RUNS_PAGE_LIMIT,
  RUN_STATES,
  parseRunsListSearchParams,
  runsListSearchParams,
  formatRunDuration,
  type RunsListFilters,
} from './runs-page.logic';

const ALL = '__all__';
const CLEARED_FILTERS: RunsListFilters = {
  channelId: undefined,
  blueprintId: undefined,
  state: undefined,
  includeDryRuns: false,
  page: 0,
};

export function RunsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseRunsListSearchParams(searchParams);
  const [cancelTarget, setCancelTarget] = useState<RunSummaryDto | null>(null);

  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api.listChannels() });
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
        limit: RUNS_PAGE_LIMIT,
        offset,
      }),
    refetchInterval: 5000,
  });

  function onRowActionSettled(runId: string) {
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: ['run', runId] });
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

  function clearFilters() {
    setSearchParams(runsListSearchParams(CLEARED_FILTERS), { replace: true });
  }

  const hasActiveFilters =
    !!filters.channelId || !!filters.blueprintId || !!filters.state || filters.includeDryRuns;

  const total = runs.data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + RUNS_PAGE_LIMIT, total);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          Every run across your channels, with live status and quick access to each one.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.channelId ?? ALL}
          onValueChange={(v) =>
            updateFilters({ channelId: v === ALL ? undefined : v, blueprintId: undefined })
          }
        >
          <SelectTrigger className="w-48">
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

        <Select
          value={filters.blueprintId ?? ALL}
          onValueChange={(v) => updateFilters({ blueprintId: v === ALL ? undefined : v })}
          disabled={!filters.channelId}
        >
          <SelectTrigger className="w-48">
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

        <Select
          value={filters.state ?? ALL}
          onValueChange={(v) => updateFilters({ state: v === ALL ? undefined : (v as RunState) })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All states</SelectItem>
            {RUN_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {formatStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={filters.includeDryRuns}
            onCheckedChange={(checked) => updateFilters({ includeDryRuns: checked })}
          />
          Include dry runs
        </label>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {runs.isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!runs.isLoading && runs.data?.items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <ListVideo className="size-8" />
          <p className="text-sm">
            {hasActiveFilters ? 'No runs match these filters.' : 'No runs yet.'}
          </p>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {runs.data && runs.data.items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Blueprint</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Spent / Budget</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.items.map((run) => {
                const rowBusy =
                  (pauseRun.isPending && pauseRun.variables === run.id) ||
                  (resumeRun.isPending && resumeRun.variables === run.id) ||
                  (cancelRun.isPending && cancelRun.variables === run.id);
                return (
                  <TableRow
                    key={run.id}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                    onClick={() => navigate(`/runs/${run.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/runs/${run.id}`);
                      }
                    }}
                  >
                    <TableCell className="font-mono" title={run.id}>
                      {run.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>{run.channelName}</TableCell>
                    <TableCell>
                      {run.blueprintName} v{run.blueprintVersion}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={runStateTone(run.state)} label={run.state} />
                    </TableCell>
                    <TableCell>
                      ${run.spentUsd.toFixed(2)} / ${run.budgetCapUsd.toFixed(2)}
                    </TableCell>
                    <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
                    <TableCell>{formatRunDuration(run.startedAt, run.endedAt)}</TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {isRunActionAllowed('pause', run.state) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label="Pause run"
                            title="Pause run"
                            disabled={rowBusy}
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
                            size="icon"
                            className="size-8"
                            aria-label="Resume run"
                            title="Resume run"
                            disabled={rowBusy}
                            onClick={() => resumeRun.mutate(run.id)}
                          >
                            {resumeRun.isPending && resumeRun.variables === run.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Play />
                            )}
                          </Button>
                        )}
                        {isRunActionAllowed('cancel', run.state) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            aria-label="Cancel run"
                            title="Cancel run"
                            disabled={rowBusy}
                            onClick={() => setCancelTarget(run)}
                          >
                            <Ban />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <AlertDialog
            open={cancelTarget !== null}
            onOpenChange={(open) => !open && setCancelTarget(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel run {cancelTarget?.id.slice(0, 8)}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This stops the run permanently and can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep running</AlertDialogCancel>
                <AlertDialogAction
                  disabled={cancelRun.isPending}
                  onClick={() => cancelTarget && cancelRun.mutate(cancelTarget.id)}
                >
                  Yes, cancel run
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Showing {showingFrom}–{showingTo} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page === 0}
                onClick={() => updateFilters({ page: filters.page - 1 })}
              >
                Prev
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
          </div>
        </>
      )}
    </section>
  );
}
