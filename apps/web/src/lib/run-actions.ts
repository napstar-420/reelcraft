import type { CreateBlueprintVersionDto, RunDetailDto, StageDef } from '@reelcraft/shared';
import { runningNow } from '@/pages/runs-page.logic';
import { definitionKey } from './stage-freshness';
import { stageDependencies } from './stage-deps';

type RunLike = Pick<RunDetailDto, 'state' | 'availableActions'> & {
  stageExecutions: Array<{ state: string; label: string; failure?: unknown }>;
};

/** The one main button a run's toolbar shows: start a fresh run, pause it, continue it,
 * or nothing while it settles or waits on a person (their review button shows instead). */
export type PrimaryRunAction = 'start' | 'pause' | 'continue' | 'none';

/** `newRunReason`: the canvas edits a test run can't take (`requiresNewRun`); a run that
 * would otherwise continue offers a fresh run instead. */
export function primaryRunAction(
  run: RunLike | undefined,
  newRunReason: string | null = null,
): PrimaryRunAction {
  if (!run) return 'start';
  const available = run.availableActions;
  if (available?.pause) return 'pause';
  if (available?.busy || run.state === 'CREATED') return 'none';
  if (run.state === 'PAUSED_APPROVAL' || run.state === 'PAUSED_INPUT') return 'none';
  const unfinished = run.stageExecutions.some((e) => e.state !== 'passed' && e.state !== 'skipped');
  if (available?.resume || (run.state === 'IDLE' && unfinished))
    return newRunReason ? 'start' : 'continue';
  return 'start';
}

const STAGE_STATUS: Record<string, string> = {
  pending: 'Not started',
  running: 'Running',
  awaiting_approval: 'Waiting for review',
  awaiting_input: 'Waiting for input',
  passed: 'Done',
  failed: 'Failed',
  stale: 'Stale',
  skipped: 'Skipped',
  cancelled: 'Stopped',
};

/** A stage's status in words. `stale`: it passed, but its definition changed since. */
export function stageStatusLabel(state: string | undefined, stale = false): string {
  if (stale) return 'Stale';
  return STAGE_STATUS[state ?? 'pending'] ?? state ?? 'Not started';
}

function failureReason(failure: unknown): string | undefined {
  return failure && typeof failure === 'object' && 'reason' in failure
    ? String(failure.reason)
    : undefined;
}

/** One line saying what the run is doing: which stages run now, or where it failed. */
export function runHeadline(run: RunLike): string | null {
  const running = runningNow(run);
  if (running.length) {
    const done = run.stageExecutions.filter((e) => e.state === 'passed').length;
    return `Running: ${running.join(', ')} (${done}/${run.stageExecutions.length} done)`;
  }
  const failed = run.stageExecutions.find((e) => e.state === 'failed');
  if (run.state === 'FAILED' && failed) {
    const reason = failureReason(failed.failure);
    return `Failed at ${failed.label}${reason ? `: ${reason}` : ''}`;
  }
  return null;
}

/** Why a run can't take these edits and needs a fresh run, or null when it can.
 * Mirrors the server's "Start a new run" blocks in `run-stage-plan.service.ts`. */
export function requiresNewRun(
  source: CreateBlueprintVersionDto,
  draft: CreateBlueprintVersionDto,
): string | null {
  const keys = (graph: StageDef[]) => graph.map((s) => s.key);
  if (definitionKey(keys(source.graph).sort()) !== definitionKey(keys(draft.graph).sort()))
    return 'Stages were added or removed since this run started.';
  if (
    (['inputs', 'roles', 'defaults'] as const).some(
      (key) => definitionKey(source[key]) !== definitionKey(draft[key]),
    )
  )
    return 'Blueprint inputs, roles or defaults changed since this run started.';
  const oldDeps = stageDependencies(source.graph);
  const newDeps = stageDependencies(draft.graph);
  if (
    definitionKey(keys(source.graph)) !== definitionKey(keys(draft.graph)) ||
    source.graph.some(
      (s) => definitionKey(oldDeps.get(s.key)) !== definitionKey(newDeps.get(s.key)),
    )
  )
    return 'Stages were reordered or reconnected since this run started.';
  return null;
}
