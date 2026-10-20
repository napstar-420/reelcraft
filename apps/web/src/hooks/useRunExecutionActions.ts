import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  RunDetailDto,
  StageRunPlanDto,
  StageRunPlanRequestDto,
  CreateBlueprintVersionDto,
} from '@reelcraft/shared';
import { api } from '@/api/client';
import { definitionKey, stageFreshness } from '@/lib/stage-freshness';
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { requiresNewRun } from '@/lib/run-actions';
import { buildRunAllDto } from '@/pages/canvas-run.logic';

type Action = NonNullable<StageRunPlanRequestDto['action']>;
export function useRunExecutionActions({
  run,
  draft,
  prepareRunnableVersion,
  onSwitchRun,
}: {
  run: RunDetailDto | undefined;
  draft?: CreateBlueprintVersionDto;
  prepareRunnableVersion?: () => Promise<string>;
  onSwitchRun?: (id: string) => void;
}) {
  const client = useQueryClient();
  const [executionPlan, setExecutionPlan] = useState<StageRunPlanDto | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [continueChoice, setContinueChoice] = useState(false);
  const draftKey = definitionKey(draft);
  useEffect(() => setExecutionPlan(null), [run?.id, run?.revision, draftKey]);
  const freshness = run?.definition && draft ? stageFreshness(run.definition, draft) : undefined;
  /** Canvas edits this run can't take (stages added, removed or rewired): start a new run. */
  const newRunReason = run?.definition && draft ? requiresNewRun(run.definition, draft) : null;
  /** Finished stages the canvas edits made out of date (changed, downstream of a change, or with
   * edited checks). Continue asks whether to regenerate them or carry on after them. */
  const outdatedPassedKeys = run
    ? run.stageExecutions
        .filter(
          (e) =>
            e.state === 'passed' &&
            (freshness?.staleStageKeys.includes(e.stageKey) ||
              freshness?.validationStageKeys.includes(e.stageKey)),
        )
        .map((e) => e.stageKey)
    : [];
  const stageLabel = (key: string) =>
    (draft?.graph ?? run?.definition?.graph)?.find((s) => s.key === key)?.label ?? key;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['run', run?.id] });
    await client.invalidateQueries({ queryKey: ['runs'] });
  };
  const fail = (error: unknown) =>
    toast.error(describeRunActionError(error, 'Could not execute this action.'));
  /** One request per button. Test runs send the canvas snapshot (so edits apply);
   * production runs send their own version, which changes nothing. */
  async function plan(
    action: Action,
    stageKey?: string,
    scope: StageRunPlanRequestDto['scope'] = 'stage',
    itemIndex?: number,
    recheck = false,
  ) {
    if (!run) throw new Error('Select a run first.');
    const blueprintVersionId = prepareRunnableVersion
      ? await prepareRunnableVersion()
      : run.blueprintVersionId;
    const request: StageRunPlanRequestDto = {
      blueprintVersionId,
      action,
      mode: recheck ? 'validate' : 'rebuild',
      scope,
      ...(stageKey && { stageKey }),
      ...(itemIndex !== undefined && { itemIndex }),
    };
    const preview = await api.previewStageRun(run.id, request);
    if (!preview.blockedReason && !preview.runStageKeys.length) {
      toast.info('Nothing left to run.');
      return;
    }
    const passed = new Set(
      run.stageExecutions.filter((e) => e.state === 'passed').map((e) => e.stageKey),
    );
    // Confirm only when the action throws away finished work or needs a decision.
    if (
      preview.blockedReason ||
      preview.invalidatedStageKeys.length ||
      preview.availabilityChangedStageKeys?.length ||
      preview.uncertainAttemptIds?.length ||
      preview.runStageKeys.some((key) => passed.has(key))
    )
      setExecutionPlan(preview);
    else {
      const result = await api.confirmStageRun(run.id, {
        ...preview.request,
        previewToken: preview.previewToken,
      });
      onSwitchRun?.(result.runId);
      await refresh();
    }
  }
  const confirmExecution = useMutation({
    mutationFn: async (plan: StageRunPlanDto) => {
      if (!run) throw new Error('Select a run first.');
      return api.confirmStageRun(run.id, { ...plan.request, previewToken: plan.previewToken });
    },
    onSuccess: async (result) => {
      setExecutionPlan(null);
      onSwitchRun?.(result.runId);
      await refresh();
    },
    onError: fail,
  });
  const acceptUncertainRestart = useMutation({
    mutationFn: async (plan: StageRunPlanDto) =>
      api.previewStageRun(run!.id, { ...plan.request, allowUncertainRestart: true }),
    onSuccess: (plan) => setExecutionPlan(plan),
    onError: fail,
  });
  /** The stage buttons: this stage only (`stage`), up to it (`through`), or from it to the
   * end (`descendants`, which regenerates what follows). `recheck` re-checks the stored
   * output without generating it again. */
  const runStage = useMutation({
    mutationFn: ({
      stageKey,
      action,
      scope = 'stage',
      itemIndex,
      recheck,
    }: {
      stageKey: string;
      action?: Action;
      scope?: StageRunPlanRequestDto['scope'];
      itemIndex?: number;
      recheck?: boolean;
    }) => {
      const available = run?.stageExecutions.find((e) => e.stageKey === stageKey)?.availableActions;
      const fallback: Action = available?.continue ? 'continue' : available?.run ? 'run' : 'rerun';
      return plan(
        scope === 'descendants' || recheck ? 'rerun' : (action ?? fallback),
        stageKey,
        scope,
        itemIndex,
        recheck,
      );
    },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run!.id),
    onSuccess: async () => {
      setConfirmCancel(false);
      await refresh();
    },
    onError: fail,
  });
  const pause = useMutation({
    mutationFn: () => api.pauseRun(run!.id),
    onSuccess: refresh,
    onError: fail,
  });
  /** Continue: keep passed stages and run everything unfinished to the end. Out-of-date finished
   * stages are regenerated, or with `keepOutdated` kept as they are and carried on after, in a new
   * run. The same new-run route handles edits this run can't take (stages added or removed). */
  const resume = useMutation({
    mutationFn: async (keepOutdated: boolean = false) => {
      if (!run || (!newRunReason && !keepOutdated)) return plan('run', undefined, 'descendants');
      const blueprintVersionId = await prepareRunnableVersion!();
      const created = await api.createRun(
        buildRunAllDto(run, blueprintVersionId, keepOutdated ? outdatedPassedKeys : []),
      );
      await api.startRun(created.id);
      onSwitchRun?.(created.id);
    },
    onSuccess: () => {
      setContinueChoice(false);
      return refresh();
    },
    onError: fail,
  });
  /** The Continue button: ask first when finished stages are out of date. */
  const requestContinue = () =>
    outdatedPassedKeys.length > 0 && prepareRunnableVersion
      ? setContinueChoice(true)
      : resume.mutate(false);
  const concurrency = useMutation({
    mutationFn: (concurrentBranches: number) =>
      api.updateExecutionSettings(run!.id, { concurrentBranches }),
    onSuccess: refresh,
    onError: fail,
  });
  return {
    runStage,
    executionPlan,
    setExecutionPlan,
    confirmExecution,
    acceptUncertainRestart,
    cancel,
    pause,
    resume,
    requestContinue,
    continueChoice,
    setContinueChoice,
    outdatedPassedKeys,
    concurrency,
    confirmCancel,
    setConfirmCancel,
    stageLabel,
    newRunReason,
    staleStageKeys: new Set(freshness?.staleStageKeys ?? []),
    validationStageKeys: new Set(freshness?.validationStageKeys ?? []),
  };
}
export type RunExecutionActions = ReturnType<typeof useRunExecutionActions>;
