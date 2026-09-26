import { intervalToDuration } from 'date-fns';
import type { RunState } from '@reelcraft/shared';

export const RUNS_PAGE_LIMIT = 20;

export type RunsListFilters = {
  channelId?: string | undefined;
  blueprintId?: string | undefined;
  state?: RunState | undefined;
  includeDryRuns: boolean;
  /** 0-based page index. */
  page: number;
};

/** `@reelcraft/shared` builds as CommonJS; importing its Zod enum as a value
 * (e.g. `RunState.options`) breaks Rollup's production build because it
 * can't statically resolve a named export through the package's `__exportStar`
 * re-export chain. This is a type-checked local mirror instead — assigning an
 * object literal to `Record<RunState, true>` makes TypeScript flag a missing
 * or extra state if `RunState` in `packages/shared/src/primitives.ts` ever
 * changes, without needing a runtime import of the value. */
const RUN_STATE_SET: Record<RunState, true> = {
  CREATED: true,
  RUNNING: true,
  PAUSED_BUDGET: true,
  PAUSED_APPROVAL: true,
  PAUSED_INPUT: true,
  PAUSED_MANUAL: true,
  FAILED: true,
  COMPLETED: true,
  CANCELLED: true,
};

export const RUN_STATES = Object.keys(RUN_STATE_SET) as RunState[];

function isRunState(value: string | null): value is RunState {
  return value !== null && Object.hasOwn(RUN_STATE_SET, value);
}

/** Reads filter/pagination state out of the URL so the Runs list page is
 * shareable/bookmarkable and survives a refresh, mirroring `BlueprintsPage`'s
 * `?tab=` pattern. */
export function parseRunsListSearchParams(searchParams: URLSearchParams): RunsListFilters {
  const channelId = searchParams.get('channel') ?? undefined;
  const blueprintId = searchParams.get('blueprint') ?? undefined;
  const stateParam = searchParams.get('state');
  const state = isRunState(stateParam) ? stateParam : undefined;
  const includeDryRuns = searchParams.get('dryRuns') === '1';
  const rawPage = Number(searchParams.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0;
  return { channelId, blueprintId, state, includeDryRuns, page };
}

/** Inverse of `parseRunsListSearchParams` — only writes params that differ
 * from the default so the URL stays clean (e.g. `?` instead of
 * `?dryRuns=0&page=0`). */
export function runsListSearchParams(filters: RunsListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.channelId) params.channel = filters.channelId;
  if (filters.blueprintId) params.blueprint = filters.blueprintId;
  if (filters.state) params.state = filters.state;
  if (filters.includeDryRuns) params.dryRuns = '1';
  if (filters.page > 0) params.page = String(filters.page);
  return params;
}

const DURATION_UNITS = ['years', 'months', 'days', 'hours', 'minutes'] as const;

/** "1 year, 3 months, 24 days, 5 hours, 40 minutes" for a finished run,
 * "Running…" while it's still going, "—" for the (should-never-happen) case
 * of a negative/invalid duration. Seconds are only shown for a sub-minute
 * run — once any larger unit is present, `date-fns`'s calendar-aware
 * `intervalToDuration` already accounts for actual month/year lengths, so
 * seconds would just be noise. */
export function formatRunDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'Running…';
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const duration = intervalToDuration({ start, end });
  const parts = DURATION_UNITS.filter((unit) => (duration[unit] ?? 0) > 0).map((unit) => {
    const value = duration[unit]!;
    const label = value === 1 ? unit.slice(0, -1) : unit;
    return `${value} ${label}`;
  });
  return parts.length > 0 ? parts.join(', ') : '0 minutes';
}
