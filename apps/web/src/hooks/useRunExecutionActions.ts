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
  const draftKey = definitionKey(draft);
  useEffect(() => setExecutionPlan(null), [run?.id, run?.revision, draftKey]);
  const freshness = run?.definition && draft ? stageFreshness(run.definition, draft) : undefined;
  /** Canvas edits this run can't take (stages added, removed or rewired): start a new run. */
  const newRunReason = run?.definition && draft ? requiresNewRun(run.definition, draft) : null;
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
  /** Continue: keep passed stages and run everything unfinished (plus anything the
   * canvas edits made stale) to the end of the blueprint. */
  const resume = useMutation({
    mutationFn: () => plan('run', undefined, 'descendants'),
    onSuccess: refresh,
    onError: fail,
  });
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
