import { canApproveWaits } from '../lib/run-action-policy';
export type ApprovalCandidateView =
  | { kind: 'text' | 'json'; text: string }
  | { kind: 'image' | 'video' | 'audio' | 'download'; url: string }
  | { kind: 'unavailable' };

export function approvalCandidateView(
  artifactKind: string,
  data: unknown,
  previewUrl?: string | null,
  downloadUrl?: string | null,
): ApprovalCandidateView {
  if (artifactKind === 'text') {
    const text =
      typeof data === 'string'
        ? data
        : typeof data === 'object' &&
            data !== null &&
            'text' in data &&
            typeof data.text === 'string'
          ? data.text
          : String(data ?? '');
    return { kind: 'text', text };
  }
  if (artifactKind === 'data' || artifactKind === 'timeline') {
    return { kind: 'json', text: JSON.stringify(data, null, 2) ?? 'null' };
  }

  const url = previewUrl ?? downloadUrl;
  if (!url) return { kind: 'unavailable' };
  if (artifactKind === 'media.image') return { kind: 'image', url };
  if (artifactKind === 'media.video') return { kind: 'video', url };
  if (artifactKind === 'media.audio') return { kind: 'audio', url };
  return { kind: 'download', url: downloadUrl ?? url };
}

export function rejectionPreviewSummary(preview: {
  affected: Array<{ stageKey: string; estimatedRerunUsd?: number }>;
  estimatedRerunUsd: number;
}) {
  return {
    stageKeys: [...new Set(preview.affected.map((entry) => entry.stageKey))],
    estimatedRerunUsd: preview.estimatedRerunUsd,
  };
}

/** Whether this stage still has an approval to answer: the run is parked and
 * the stage's own wait is open (a run can hold several at once). */
export function isApprovalStillOpen(
  stageKey: string,
  run: { state: string; stageExecutions: Array<{ stageKey: string; waiting?: string | null }> },
) {
  return (
    canApproveWaits(run.state) &&
    run.stageExecutions.some((e) => e.stageKey === stageKey && e.waiting === 'approval')
  );
}

export function describeApiFailure(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 409
  ) {
    return 'This approval was already resolved or changed. Refresh the run and review its latest state.';
  }
  if (error instanceof Error) return error.message;
  return 'The approval action failed. Please try again.';
}
