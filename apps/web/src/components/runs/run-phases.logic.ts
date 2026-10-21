import type { RunDetailDto, StageExecutionDto } from '@reelcraft/shared';
import { displayStageState } from '@/lib/run-actions';
import type { StatusTone } from '@/lib/status';
import { stageDependencies } from '@/lib/stage-deps';

/** What the run page shows for a stage or a phase. `next` is not stored: it is derived. */
export type ViewState = 'done' | 'running' | 'waiting' | 'failed' | 'next' | 'pending' | 'skipped';
export type PhaseState = Exclude<ViewState, 'skipped'> | 'partial';

export type StageView = {
  key: string;
  label: string;
  /** 1-based position in the blueprint. */
  index: number;
  state: ViewState;
  deps: string[];
  phaseId: string;
  execution: StageExecutionDto;
};

export type Phase = {
  id: string;
  name: string;
  stages: StageView[];
  state: PhaseState;
  /** Stages finished, and stages that count (skipped ones don't). */
  done: number;
  total: number;
  /** Phases this one waits for. */
  deps: string[];
  /** Left-to-right layer in the graph. */
  column: number;
};

export type RunView = {
  stages: StageView[];
  phases: Phase[];
  running: StageView[];
  next: StageView[];
  recent: StageView[];
  failed: StageView[];
  waiting: StageView[];
};

type RunInput = Pick<RunDetailDto, 'availableActions' | 'stageExecutions' | 'definition'>;

function viewState(execution: StageExecutionDto, run: RunInput): ViewState {
  if (execution.disabled) return 'skipped';
  switch (displayStageState(execution, run)) {
    case 'passed':
    case 'stale':
      return 'done';
    case 'skipped':
      return 'skipped';
    case 'running':
      return 'running';
    case 'awaiting_approval':
    case 'awaiting_input':
      return 'waiting';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

const SETTLED: ViewState[] = ['done', 'skipped'];

function phaseState(stages: StageView[]): PhaseState {
  const has = (state: ViewState) => stages.some((s) => s.state === state);
  for (const state of ['failed', 'waiting', 'running'] as const) if (has(state)) return state;
  if (stages.every((s) => SETTLED.includes(s.state))) return 'done';
  if (has('done')) return 'partial';
  return has('next') ? 'next' : 'pending';
}

/** Longest path from a root, ignoring back edges so a phase that interleaves with another can't loop. */
function columns(phases: Array<{ id: string; deps: string[] }>): Map<string, number> {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    const level = Math.max(-1, ...(byId.get(id)?.deps ?? []).map(visit)) + 1;
    visiting.delete(id);
    column.set(id, level);
    return level;
  };
  phases.forEach((p) => visit(p.id));
  return column;
}

/** The run as the page draws it: phases (stages grouped by their `group`), and what is running,
 * up next and finished. A stage with no group is a phase of its own. */
export function buildRunView(run: RunInput): RunView {
  const graph = run.definition?.graph ?? [];
  const deps = graph.length ? stageDependencies(graph) : new Map<string, string[]>();
  const groupOf = new Map(graph.map((s) => [s.key, s.group?.trim() || undefined]));
  const order = new Map(graph.map((s, i) => [s.key, i]));
  const executions = [...run.stageExecutions].sort(
    (a, b) => (order.get(a.stageKey) ?? 0) - (order.get(b.stageKey) ?? 0),
  );

  const stages: StageView[] = executions.map((execution, i) => ({
    key: execution.stageKey,
    label: execution.label,
    index: i + 1,
    state: viewState(execution, run),
    deps: deps.get(execution.stageKey) ?? [],
    phaseId: groupOf.get(execution.stageKey) ?? execution.stageKey,
    execution,
  }));
  const byKey = new Map(stages.map((s) => [s.key, s]));
  // Up next: not started, and everything it waits for is finished or running (so it starts the
  // moment that ends). Judged on the stored states, so one next stage doesn't make the one after it next.
  const stored = new Map(stages.map((s) => [s.key, s.state]));
  for (const stage of stages) {
    if (
      stage.state === 'pending' &&
      stage.deps.every((d) => ['done', 'skipped', 'running'].includes(stored.get(d) ?? ''))
    )
      stage.state = 'next';
  }

  const ids = [...new Set(stages.map((s) => s.phaseId))];
  const rawPhases = ids.map((id) => {
    const members = stages.filter((s) => s.phaseId === id);
    const phaseDeps = [
      ...new Set(members.flatMap((s) => s.deps.map((d) => byKey.get(d)?.phaseId))),
    ].filter((d): d is string => !!d && d !== id);
    return { id, members, deps: phaseDeps };
  });
  const column = columns(rawPhases);
  const phases: Phase[] = rawPhases.map(({ id, members, deps: phaseDeps }) => {
    const counted = members.filter((s) => s.state !== 'skipped');
    return {
      id,
      name: members.length === 1 && id === members[0]!.key ? members[0]!.label : id,
      stages: members,
      state: phaseState(members),
      done: counted.filter((s) => s.state === 'done').length,
      total: counted.length,
      deps: phaseDeps,
      column: column.get(id) ?? 0,
    };
  });

  const ended = (s: StageView) => s.execution.endedAt ?? '';
  return {
    stages,
    phases,
    running: stages.filter((s) => s.state === 'running'),
    next: stages.filter((s) => s.state === 'next'),
    recent: stages
      .filter((s) => s.state === 'done' && s.execution.endedAt)
      .sort((a, b) => ended(b).localeCompare(ended(a)))
      .slice(0, 3),
    failed: stages.filter((s) => s.state === 'failed'),
    waiting: stages.filter((s) => s.state === 'waiting'),
  };
}

export const VIEW_LABEL: Record<ViewState | PhaseState, string> = {
  done: 'Done',
  running: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  next: 'Up next',
  pending: 'Not started',
  skipped: 'Skipped',
  partial: 'In progress',
};

export function viewTone(state: ViewState | PhaseState): StatusTone {
  switch (state) {
    case 'done':
      return 'success';
    case 'running':
    case 'partial':
      return 'running';
    case 'waiting':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}
