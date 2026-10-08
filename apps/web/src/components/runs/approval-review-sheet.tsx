import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { describeApiFailure, rejectionPreviewSummary } from '@/pages/approval-review.logic';
import { ArtifactPreview } from './artifact-preview';

type RejectionPreview = Awaited<ReturnType<typeof api.previewStageRejection>>;

export function ApprovalReviewSheet({
  runId,
  stageKey,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<RejectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which waiting item to look at, when a stage that runs items at the same
  // time has several; empty means the first one waiting.
  const [chosenItem, setChosenItem] = useState<number | undefined>(undefined);
  const candidateQuery = useQuery({
    queryKey: ['approval-candidate', runId, stageKey, chosenItem],
    queryFn: () => api.getApprovalCandidate(runId, stageKey as string, chosenItem),
    enabled: open && Boolean(stageKey),
    retry: false,
  });

  useEffect(() => {
    setNote('');
    setPreview(null);
    setError(null);
    setChosenItem(undefined);
  }, [stageKey, open]);

  const othersWaiting = (candidateQuery.data?.pendingItemIndexes.length ?? 0) > 1;
  /** After approving or rejecting: on to the next waiting item, or done. */
  const finish = async (more = false) => {
    await queryClient.invalidateQueries({ queryKey: ['run', runId] });
    if (more && othersWaiting) {
      setNote('');
      setPreview(null);
      setError(null);
      setChosenItem(undefined);
      await queryClient.invalidateQueries({ queryKey: ['approval-candidate', runId, stageKey] });
      return;
    }
    onOpenChange(false);
  };
  const fail = (cause: unknown) => setError(describeApiFailure(cause));
  const itemIndex = candidateQuery.data?.itemIndex ?? undefined;

  const approve = useMutation({
    mutationFn: () => api.approveStage(runId, stageKey as string, itemIndex),
    onSuccess: () => finish(true),
    onError: fail,
  });
  const retryQc = useMutation({
    mutationFn: () => api.retryStageQc(runId, stageKey as string, itemIndex),
    onSuccess: () => finish(),
    onError: fail,
  });
  const previewRejection = useMutation({
    mutationFn: () =>
      api.previewStageRejection(runId, stageKey as string, note.trim() || undefined, itemIndex),
    onSuccess: (result) => {
      setError(null);
      setPreview(result);
    },
    onError: fail,
  });
  const confirmRejection = useMutation({
    mutationFn: () =>
      api.confirmStageRejection(
        runId,
        stageKey as string,
        preview!.previewToken,
        note.trim() || undefined,
        itemIndex,
      ),
    onSuccess: () => finish(true),
    onError: fail,
  });
  const busy =
    approve.isPending ||
    retryQc.isPending ||
    previewRejection.isPending ||
    confirmRejection.isPending;
  const summary = useMemo(
    () =>
      preview
        ? rejectionPreviewSummary({
            affected: preview.affectedStageKeys.map((affectedStageKey) => ({
              stageKey: affectedStageKey,
            })),
            estimatedRerunUsd: preview.estimatedRerunUsd,
          })
        : null,
    [preview],
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Review output</SheetTitle>
          <SheetDescription>
            {stageKey ? `Review ${stageKey} before the run continues.` : 'Review stage output.'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          {candidateQuery.isLoading ? (
            <div className="flex flex-col gap-3 py-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-52 w-full" />
            </div>
          ) : candidateQuery.isError ? (
            <Alert variant="destructive" className="my-4">
              <AlertCircle />
              <AlertTitle>Output is no longer available</AlertTitle>
              <AlertDescription>{describeApiFailure(candidateQuery.error)}</AlertDescription>
            </Alert>
          ) : candidateQuery.data ? (
            <>
              {candidateQuery.data.attempt.qcUnavailable !== null ? (
                <Alert className="mt-4">
                  <AlertCircle />
                  <AlertTitle>Quality control could not run</AlertTitle>
                  <AlertDescription>
                    {candidateQuery.data.attempt.qcUnavailable} The output below has not been
                    judged. Retry QC once the judge is back, approve it as it is, or reject it.
                  </AlertDescription>
                </Alert>
              ) : null}
              {candidateQuery.data.pendingItemIndexes.length > 1 ? (
                <WaitingItems
                  indexes={candidateQuery.data.pendingItemIndexes}
                  current={candidateQuery.data.itemIndex}
                  disabled={busy}
                  onPick={(index) => {
                    setNote('');
                    setPreview(null);
                    setChosenItem(index);
                  }}
                />
              ) : null}
              <ApprovalCandidate candidate={candidateQuery.data} />
            </>
          ) : null}

          {error ? (
            <Alert variant="destructive" className="my-4">
              <AlertCircle />
              <AlertTitle>Could not update approval</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {candidateQuery.data && !preview ? (
            <div className="flex flex-col gap-2 py-4">
              <label htmlFor="approval-rejection-note" className="text-sm font-medium">
                Rejection note <span className="text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="approval-rejection-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
                placeholder="Explain what should change on the next attempt"
              />
            </div>
          ) : null}

          {preview && summary ? (
            <div className="my-4 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div>
                <h3 className="font-medium">Confirm rejection</h3>
                <p className="text-sm text-muted-foreground">
                  This will invalidate {summary.stageKeys.join(', ') || 'the current stage'} and
                  rerun from {preview.targetStageKey}.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Affected stages</dt>
                  <dd className="font-medium">{summary.stageKeys.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Estimated rerun</dt>
                  <dd className="font-medium">${summary.estimatedRerunUsd.toFixed(4)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </ScrollArea>

        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {preview ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => confirmRejection.mutate()}
              >
                {confirmRejection.isPending ? <Loader2 className="animate-spin" /> : null}
                Confirm rejection
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy || !candidateQuery.data}
                onClick={() => previewRejection.mutate()}
              >
                {previewRejection.isPending ? <Loader2 className="animate-spin" /> : null}
                Reject
              </Button>
              {candidateQuery.data?.attempt.qcUnavailable !== null &&
              candidateQuery.data !== undefined ? (
                <Button disabled={busy} onClick={() => retryQc.mutate()}>
                  {retryQc.isPending ? <Loader2 className="animate-spin" /> : null}
                  Retry QC
                </Button>
              ) : null}
              <Button
                variant={candidateQuery.data?.attempt.qcUnavailable ? 'outline' : 'default'}
                disabled={busy || !candidateQuery.data}
                onClick={() => approve.mutate()}
              >
                {approve.isPending ? <Loader2 className="animate-spin" /> : null}
                Approve
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The items of a stage waiting for review together; the one on screen is marked. */
function WaitingItems({
  indexes,
  current,
  disabled,
  onPick,
}: {
  indexes: number[];
  current: number | null;
  disabled: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {indexes.length} items are waiting for review.
      </p>
      <div className="flex flex-wrap gap-2">
        {indexes.map((index) => (
          <Button
            key={index}
            type="button"
            size="sm"
            variant={index === current ? 'default' : 'outline'}
            disabled={disabled}
            aria-pressed={index === current}
            onClick={() => onPick(index)}
          >
            Item {index + 1}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ApprovalCandidate({
  candidate,
}: {
  candidate: Awaited<ReturnType<typeof api.getApprovalCandidate>>;
}) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Attempt</dt>
          <dd className="font-medium">{candidate.attempt.attemptNo}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Cost</dt>
          <dd className="font-medium">${candidate.attempt.costUsd.toFixed(4)}</dd>
        </div>
        {candidate.itemIndex !== null ? (
          <div>
            <dt className="text-muted-foreground">Item</dt>
            <dd className="font-medium">{candidate.itemIndex + 1}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="font-medium">{new Date(candidate.attempt.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      <ArtifactPreview artifact={candidate.artifact} />

      {candidate.attempt.checkResults !== null || candidate.attempt.qcVerdict !== null ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Checks and quality review
          </summary>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(
              {
                ...(candidate.attempt.checkResults !== null
                  ? { checks: candidate.attempt.checkResults }
                  : {}),
                ...(candidate.attempt.qcVerdict !== null
                  ? { quality: candidate.attempt.qcVerdict }
                  : {}),
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
