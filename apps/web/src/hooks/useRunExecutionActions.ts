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
  const [executionPlans, setExecutionPlans] = useState<StageRunPlanDto[] | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const draftKey = definitionKey(draft);
  useEffect(() => setExecutionPlans(null), [run?.id, run?.revision, draftKey]);
  const freshness = run?.definition && draft ? stageFreshness(run.definition, draft) : undefined;
  const stageLabel = (key: string) =>
    (draft?.graph ?? run?.definition?.graph)?.find((s) => s.key === key)?.label ?? key;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['run', run?.id] });
    await client.invalidateQueries({ queryKey: ['runs'] });
  };
  const fail = (error: unknown) =>
    toast.error(describeRunActionError(error, 'Could not execute this action.'));
  async function plan(
    action: Action,
    stageKey?: string,
    scope: StageRunPlanRequestDto['scope'] = 'stage',
    itemIndex?: number,
  ) {
    if (!run) throw new Error('Select a run first.');
    const blueprintVersionId = prepareRunnableVersion
      ? await prepareRunnableVersion()
      : run.blueprintVersionId;
    const request: StageRunPlanRequestDto = {
      blueprintVersionId,
      action,
      mode: action === 'continue' ? 'reuse' : 'rebuild',
      scope,
      ...(stageKey && { stageKey }),
      ...(itemIndex !== undefined && { itemIndex }),
    };
    const changed =
      blueprintVersionId !== run.blueprintVersionId &&
      !!freshness &&
      (freshness.staleStageKeys.length > 0 || freshness.validationStageKeys.length > 0);
    const requests =
      changed && stageKey
        ? [
            { ...request, mode: 'reuse' as const },
            { ...request, mode: 'rebuild' as const },
            { ...request, mode: 'rebuild' as const, scope: 'through' as const },
            { ...request, mode: 'rebuild' as const, scope: 'descendants' as const },
            ...(freshness.validationStageKeys.includes(stageKey)
              ? [{ ...request, mode: 'validate' as const }]
              : []),
          ]
        : [request];
    const plans = await Promise.all(requests.map((r) => api.previewStageRun(run.id, r)));
    const first = plans[0]!;
    if (!first.blockedReason && !first.runStageKeys.length) {
      toast.info('This run has no unfinished work.');
      return;
    }
    if (
      !changed &&
      action !== 'rerun' &&
      !first.blockedReason &&
      !first.invalidatedStageKeys.length &&
      !first.availabilityChangedStageKeys?.length &&
      !first.uncertainAttemptIds?.length
    ) {
      const result = await api.confirmStageRun(run.id, {
        ...first.request,
        previewToken: first.previewToken,
      });
      onSwitchRun?.(result.runId);
      await refresh();
    } else setExecutionPlans(plans);
  }
  const confirmExecution = useMutation({
    mutationFn: async (plan: StageRunPlanDto) => {
      if (!run) throw new Error('Select a run first.');
      return api.confirmStageRun(run.id, { ...plan.request, previewToken: plan.previewToken });
    },
    onSuccess: async (result) => {
      setExecutionPlans(null);
      onSwitchRun?.(result.runId);
      await refresh();
    },
    onError: fail,
  });
  const acceptUncertainRestart = useMutation({
    mutationFn: async (plan: StageRunPlanDto) =>
      api.previewStageRun(run!.id, { ...plan.request, allowUncertainRestart: true }),
    onSuccess: (plan) => setExecutionPlans([plan]),
    onError: fail,
  });
  const runStage = useMutation({
    mutationFn: ({
      stageKey,
      action,
      scope,
      itemIndex,
    }: {
      stageKey: string;
      action?: Action;
      scope?: StageRunPlanRequestDto['scope'];
      itemIndex?: number;
      anyway?: boolean;
    }) => {
      const available = run?.stageExecutions.find((e) => e.stageKey === stageKey)?.availableActions;
      return plan(
        action ?? (available?.continue ? 'continue' : available?.run ? 'run' : 'rerun'),
        stageKey,
        scope,
        itemIndex,
      );
    },
    onError: fail,
  });
  const runAll = useMutation({
    mutationFn: (action: Action = 'run') => plan(action, undefined, 'descendants'),
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
  const resume = useMutation({
    mutationFn: async () => {
      if (run?.state === 'CANCELLED') await plan('continue', undefined, 'descendants');
      else await api.resumeRun(run!.id);
    },
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
    runAll,
    executionPlans,
    setExecutionPlans,
    confirmExecution,
    acceptUncertainRestart,
    cancel,
    pause,
    resume,
    concurrency,
    confirmCancel,
    setConfirmCancel,
    stageLabel,
    staleStageKeys: new Set(freshness?.staleStageKeys ?? []),
    validationStageKeys: new Set(freshness?.validationStageKeys ?? []),
  };
}
export type RunExecutionActions = ReturnType<typeof useRunExecutionActions>;
