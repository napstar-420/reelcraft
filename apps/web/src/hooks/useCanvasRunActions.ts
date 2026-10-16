import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  RunDetailDto,
  SeedPlanDto,
  StageDef,
  StageRunPlanDto,
  CreateBlueprintVersionDto,
} from '@reelcraft/shared';
import { stageFreshness, definitionKey } from '@/lib/stage-freshness';
import { api } from '@/api/client';
import { buildRunAllDto, buildRunStageDto, upstreamRerunPlan } from '@/pages/canvas-run.logic';
import { describeRunActionError } from '@/lib/describe-run-action-error';

/** The canvas's run actions (run one stage, run all, pause/resume/cancel) and
 * the sheets they open. Lives above both the nodes and the Run tab, so a
 * stage card's play button and the tab's buttons share one set of mutations. */
export function useCanvasRunActions({
  blueprintId,
  run,
  graph,
  draft,
  onSwitchRun,
  prepareRunnableVersion,
}: {
  blueprintId: string;
  run: RunDetailDto | undefined;
  graph: StageDef[];
  draft: CreateBlueprintVersionDto;
  onSwitchRun: (runId: string) => void;
  prepareRunnableVersion: () => Promise<string>;
}) {
  const queryClient = useQueryClient();
  const [outputSheetKey, setOutputSheetKey] = useState<string | null>(null);
  const [attemptsSheetKey, setAttemptsSheetKey] = useState<string | null>(null);
  const [approvalStageKey, setApprovalStageKey] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** "Run this stage" was refused because an earlier stage would run again;
   * the sheet asks whether to go ahead. */
  const [upstreamRerun, setUpstreamRerun] = useState<{
    stageKey: string;
    plan: SeedPlanDto;
    sourceRunId: string;
  } | null>(null);

  const [executionPlans, setExecutionPlans] = useState<StageRunPlanDto[] | null>(null);
  const draftKey = definitionKey(draft);
  useEffect(() => {
    setExecutionPlans(null);
  }, [draftKey, run?.id, run?.blueprintVersionId]);
  const freshness = run?.definition ? stageFreshness(run.definition, draft) : undefined;
  const staleStageKeys = new Set(freshness?.staleStageKeys ?? []);
  const validationStageKeys = new Set(freshness?.validationStageKeys ?? []);

  const stageLabel = (stageKey: string) => graph.find((s) => s.key === stageKey)?.label ?? stageKey;

  function afterStart(runId: string) {
    onSwitchRun(runId);
    void queryClient.invalidateQueries({ queryKey: ['run', runId] });
    void queryClient.invalidateQueries({ queryKey: ['runs', { blueprintId }] });
  }

  async function planExecution(blueprintVersionId: string, stageKey?: string) {
    if (!run) throw new Error('No previous run to build on yet.');
    const requests = stageKey
      ? [
          { blueprintVersionId, stageKey, mode: 'reuse' as const, scope: 'stage' as const },
          { blueprintVersionId, stageKey, mode: 'rebuild' as const, scope: 'stage' as const },
          { blueprintVersionId, stageKey, mode: 'rebuild' as const, scope: 'descendants' as const },
        ]
      : [{ blueprintVersionId, mode: 'rebuild' as const, scope: 'descendants' as const }];
    const plans = await Promise.all([
      ...requests.map((request) => api.previewStageRun(run.id, request)),
      ...(stageKey && validationStageKeys.has(stageKey)
        ? [
            api.previewStageRun(run.id, {
              blueprintVersionId,
              stageKey,
              mode: 'validate',
              scope: 'stage',
            }),
          ]
        : []),
    ]);
    const automatic = plans.find(
      (plan) =>
        plan.request.mode === 'rebuild' && (stageKey ? plan.request.scope === 'stage' : true),
    );
    if (
      automatic &&
      !automatic.blockedReason &&
      automatic.staleStageKeys.length === 0 &&
      automatic.validationStageKeys.length === 0 &&
      automatic.invalidatedStageKeys.length === 0
    ) {
      if (automatic.runStageKeys.length === 0) {
        toast.info('This run has no unfinished work.');
        return run.id;
      }
      const accepted = await api.confirmStageRun(run.id, {
        ...automatic.request,
        previewToken: automatic.previewToken,
      });
      return accepted.runId;
    }
    setExecutionPlans(plans);
    return undefined;
  }

  const confirmExecution = useMutation({
    mutationFn: async (plan: StageRunPlanDto) => {
      if (!run) throw new Error('The selected run changed.');
      const currentVersion = await prepareRunnableVersion();
      if (currentVersion !== plan.request.blueprintVersionId)
        throw new Error('The draft changed. Close this dialog and review a new execution plan.');
      return api.confirmStageRun(run.id, { ...plan.request, previewToken: plan.previewToken });
    },
    onSuccess: (result) => {
      setExecutionPlans(null);
      afterStart(result.runId);
    },
    onError: (error) => toast.error(describeRunActionError(error, 'Could not execute this plan.')),
  });

  const runStage = useMutation({
    mutationFn: async ({ stageKey, anyway }: { stageKey: string; anyway?: boolean }) => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      if (!anyway && ['COMPLETED', 'FAILED'].includes(run.state))
        return planExecution(blueprintVersionId, stageKey);
      const created = await api.createRun(
        buildRunStageDto(run, blueprintVersionId, stageKey, { anyway }),
      );
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: (runId) => {
      if (runId) afterStart(runId);
    },
    onError: (error, { stageKey }) => {
      const plan = upstreamRerunPlan(error);
      if (plan && run) setUpstreamRerun({ stageKey, plan, sourceRunId: run.id });
      else toast.error(describeRunActionError(error, 'Could not start the stage.'));
    },
  });

  const runAll = useMutation({
    mutationFn: async () => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      if (['COMPLETED', 'FAILED'].includes(run.state)) return planExecution(blueprintVersionId);
      const created = await api.createRun(buildRunAllDto(run, blueprintVersionId));
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: (runId) => {
      if (runId) afterStart(runId);
    },
    onError: (error) => toast.error(describeRunActionError(error, 'Could not start the run.')),
  });

  const invalidateRun = () => queryClient.invalidateQueries({ queryKey: ['run', run?.id] });
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run!.id),
    onSuccess: invalidateRun,
  });
  const pause = useMutation({ mutationFn: () => api.pauseRun(run!.id), onSuccess: invalidateRun });
  const resume = useMutation({
    mutationFn: () => api.resumeRun(run!.id),
    onSuccess: invalidateRun,
  });

  return {
    runStage,
    runAll,
    executionPlans,
    setExecutionPlans,
    confirmExecution,
    staleStageKeys,
    validationStageKeys,
    cancel,
    pause,
    resume,
    stageLabel,
    outputSheetKey,
    setOutputSheetKey,
    attemptsSheetKey,
    setAttemptsSheetKey,
    approvalStageKey,
    setApprovalStageKey,
    confirmCancel,
    setConfirmCancel,
    upstreamRerun,
    setUpstreamRerun,
  };
}

export type CanvasRunActions = ReturnType<typeof useCanvasRunActions>;
