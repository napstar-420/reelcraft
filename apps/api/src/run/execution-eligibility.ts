import {
  disabledAncestor,
  stageDependencies,
  stageRefLeaves,
  type StageDef,
  type Ref,
  type RunState,
  type StageAvailableActions,
  type RunAvailableActions,
} from '@reelcraft/shared';
import { isStageEnabled } from '../orchestration/enabled-when';

export interface ExecutionSummary {
  stageKey: string;
  state: string;
  isIterating?: boolean;
  itemCount?: number | null;
  outputArtifactId?: string | null;
  completedItems?: number;
  waiting?: string | null;
}
export function executionEligibility(
  graph: StageDef[],
  rows: ExecutionSummary[],
  inputs: Record<string, unknown>,
  state: RunState,
  activeAttempts = false,
) {
  const busy = ['RUNNING', 'PAUSING', 'CANCELLING'].includes(state) || activeAttempts;
  const inactive = !busy && state !== 'CREATED';
  const deps = stageDependencies(graph);
  const stages: Record<string, StageAvailableActions> = {};
  for (const stage of graph) {
    const execution = rows.find((row) => row.stageKey === stage.key);
    let blockedReason: string | null = busy
      ? 'The run is executing. Pause or cancel it before starting another action.'
      : null;
    const ancestor = disabledAncestor(graph, stage.key);
    if (ancestor)
      blockedReason ??= `Disabled ancestor: ${ancestor.label || ancestor.key}. Enable it before running this stage.`;
    if (!isStageEnabled(stage.enabledWhen, inputs))
      blockedReason = 'This stage is disabled by its Enabled when condition.';
    const missingInput = (ref: Ref): string | undefined => {
      if (ref.from === 'input' && inputs[ref.inputKey] === undefined) return ref.inputKey;
      if (ref.from === 'coalesce') {
        const missing = ref.refs.map(missingInput);
        if (missing.every(Boolean)) return missing[0];
      }
      return undefined;
    };
    for (const ref of [
      ...Object.values(stage.slots),
      ...Object.values(stage.context),
      ...(stage.iterate ? [stage.iterate.over] : []),
    ]) {
      const missing = missingInput(ref);
      if (missing) blockedReason ??= `Missing input: ${missing}.`;
    }
    for (const key of deps.get(stage.key) ?? []) {
      const parent = rows.find((row) => row.stageKey === key);
      const definition = graph.find((s) => s.key === key);
      const disabled = definition && !isStageEnabled(definition.enabledWhen, inputs);
      if (
        !disabled &&
        (parent?.state !== 'passed' ||
          (parent.isIterating && (parent.completedItems ?? 0) < (parent.itemCount ?? 0)))
      ) {
        blockedReason ??= `Waiting for ${definition?.label ?? key}.`;
      }
      const readsOutput = stageRefLeaves(stage).some(
        (ref) => ref.from === 'stage' && ref.stageKey === key,
      );
      if (disabled && readsOutput)
        blockedReason ??= `${definition?.label ?? key} is disabled and has no required output.`;
    }
    if (execution?.waiting) blockedReason ??= 'Resolve the saved approval or input request first.';
    const completed = execution?.completedItems ?? 0;
    const ready = inactive && !blockedReason;
    const unfinished = execution?.isIterating
      ? completed < (execution.itemCount ?? 0) || execution.state !== 'passed'
      : execution?.state !== 'passed';
    const started =
      !!execution &&
      ((execution.state !== 'pending' && execution.state !== 'skipped') || completed > 0);
    const scopeReady =
      inactive &&
      !ancestor &&
      !stage.disabled &&
      isStageEnabled(stage.enabledWhen, inputs) &&
      !execution?.waiting &&
      !blockedReason?.startsWith('Missing input:');
    stages[stage.key] = {
      runThrough: scopeReady,
      rebuildDescendants: scopeReady && started,
      run: ready && !started,
      continue: ready && started && unfinished,
      rerun: ready && started,
      blockedReason,
      completedItems: completed,
      totalItems: execution?.itemCount ?? null,
    };
  }
  const run: RunAvailableActions = {
    busy,
    pause: state === 'RUNNING',
    resume:
      !busy &&
      ['PAUSED_MANUAL', 'CANCELLED', 'FAILED', 'PAUSED_BUDGET', 'PAUSED_QUOTA'].includes(state),
    // Stop ends live, paused or never-started work; a failed run has nothing left to stop.
    cancel: [
      'RUNNING',
      'PAUSING',
      'IDLE',
      'CREATED',
      'PAUSED_MANUAL',
      'PAUSED_APPROVAL',
      'PAUSED_INPUT',
      'PAUSED_BUDGET',
      'PAUSED_QUOTA',
    ].includes(state),
    changeConcurrency: !busy,
  };
  return { run, stages };
}

/** Whether a run's execution scope still has unfinished work: a stage that has not passed, or one
 * that passed but holds items made out of date. Continue stays inside the scope while it does;
 * once the scope is done (a one-item re-run, say) Continue carries on with the rest of the run. */
export function scopeHasWork(
  scoped: readonly string[] | null | undefined,
  passed: ReadonlySet<string>,
  staleItemKeys: ReadonlySet<string>,
): boolean {
  return !!scoped?.some((key) => !passed.has(key) || staleItemKeys.has(key));
}
