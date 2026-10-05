import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RunDetailDto, StageDef } from '@reelcraft/shared';
import { api } from '@/api/client';
import { buildRunAllDto, buildRunStageDto } from '@/pages/canvas-run.logic';
import { describeRunActionError } from '@/lib/describe-run-action-error';

/** The canvas's run actions (run one stage, run all, pause/resume/cancel) and
 * the sheets they open. Lives above both the nodes and the Run tab, so a
 * stage card's play button and the tab's buttons share one set of mutations. */
export function useCanvasRunActions({
  blueprintId,
  run,
  graph,
  onSwitchRun,
  prepareRunnableVersion,
}: {
  blueprintId: string;
  run: RunDetailDto | undefined;
  graph: StageDef[];
  onSwitchRun: (runId: string) => void;
  prepareRunnableVersion: () => Promise<string>;
}) {
  const queryClient = useQueryClient();
  const [outputSheetKey, setOutputSheetKey] = useState<string | null>(null);
  const [attemptsSheetKey, setAttemptsSheetKey] = useState<string | null>(null);
  const [approvalStageKey, setApprovalStageKey] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const stageLabel = (stageKey: string) => graph.find((s) => s.key === stageKey)?.label ?? stageKey;

  function afterStart(runId: string) {
    onSwitchRun(runId);
    void queryClient.invalidateQueries({ queryKey: ['runs', { blueprintId }] });
  }

  const runStage = useMutation({
    mutationFn: async (stageKey: string) => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      const created = await api.createRun(buildRunStageDto(run, blueprintVersionId, stageKey));
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: afterStart,
    onError: (error) => toast.error(describeRunActionError(error, 'Could not start the stage.')),
  });

  const runAll = useMutation({
    mutationFn: async () => {
      const blueprintVersionId = await prepareRunnableVersion();
      if (!run) throw new Error('No previous run to build on yet.');
      const created = await api.createRun(buildRunAllDto(run, blueprintVersionId));
      await api.startRun(created.id);
      return created.id;
    },
    onSuccess: afterStart,
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
  };
}

export type CanvasRunActions = ReturnType<typeof useCanvasRunActions>;
