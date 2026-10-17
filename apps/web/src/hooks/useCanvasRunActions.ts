import { useState } from 'react';
import type { RunDetailDto, CreateBlueprintVersionDto } from '@reelcraft/shared';
import { useRunExecutionActions } from './useRunExecutionActions';
/** The canvas's run actions (run one stage, run all, pause/resume/cancel) and
 * the sheets they open. Lives above both the nodes and the Run tab, so a
 * stage card's play button and the tab's buttons share one set of mutations. */
export function useCanvasRunActions({
  run,
  draft,
  onSwitchRun,
  prepareRunnableVersion,
}: {
  run: RunDetailDto | undefined;
  draft: CreateBlueprintVersionDto;
  onSwitchRun: (runId: string) => void;
  prepareRunnableVersion: () => Promise<string>;
}) {
  const execution = useRunExecutionActions({ run, draft, prepareRunnableVersion, onSwitchRun });
  const [outputSheetKey, setOutputSheetKey] = useState<string | null>(null);
  const [attemptsSheetKey, setAttemptsSheetKey] = useState<string | null>(null);
  const [approvalStageKey, setApprovalStageKey] = useState<string | null>(null);
  return {
    ...execution,
    outputSheetKey,
    setOutputSheetKey: (key: string | null) => {
      setAttemptsSheetKey(null);
      setOutputSheetKey(key);
    },
    attemptsSheetKey,
    setAttemptsSheetKey: (key: string | null) => {
      setOutputSheetKey(null);
      setAttemptsSheetKey(key);
    },
    approvalStageKey,
    setApprovalStageKey,
  };
}

export type CanvasRunActions = ReturnType<typeof useCanvasRunActions>;
