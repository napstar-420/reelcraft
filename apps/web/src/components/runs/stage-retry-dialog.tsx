import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { RetryItems, RetryScope } from '@reelcraft/shared';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { describeRunActionError } from '@/lib/describe-run-action-error';

const SCOPE_COPY: Record<RetryScope, { title: string; description: string }> = {
  dependents: {
    title: 'Re-run',
    description: 'Re-runs this stage and the later stages that use its output.',
  },
  stage: {
    title: 'Re-run only',
    description: 'Re-runs just this stage. Later stages keep their current outputs.',
  },
  downstream: {
    title: 'Re-run from',
    description: 'Re-runs this stage and every stage after it.',
  },
};

const FAILED_ITEMS_COPY = {
  title: 'Retry failed items of',
  description: 'Re-runs only the items that failed. Items that passed keep their outputs.',
};

export function StageRetryDialog({
  runId,
  stageKey,
  stageLabel,
  scope = 'dependents',
  items,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  stageLabel?: string | null;
  scope?: RetryScope;
  /** `failed`: re-run only the stage's failed items, instead of the whole stage. */
  items?: RetryItems;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['stage-retry-preview', runId, stageKey, scope, items],
    queryFn: () =>
      api.previewStageRetry(runId, stageKey as string, { scope, ...(items && { items }) }),
    enabled: open && Boolean(stageKey),
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmStageRetry(runId, stageKey as string, {
        previewToken: preview.data!.previewToken,
        scope,
        ...(items && { items }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      onOpenChange(false);
    },
  });

  const affectedStageKeys = preview.data
    ? [...new Set(preview.data.affected.map((entry) => entry.stageKey))]
    : [];
  const itemNumbers = (preview.data?.items ?? []).map((entry) => entry.itemIndex + 1);
  const copy = items === 'failed' ? FAILED_ITEMS_COPY : SCOPE_COPY[scope];

  return (
    <Dialog open={open} onOpenChange={(next) => !confirm.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {copy.title} {stageLabel ?? stageKey}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : preview.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not preview this retry</AlertTitle>
            <AlertDescription>
              {describeRunActionError(preview.error, 'The retry preview failed.')}
            </AlertDescription>
          </Alert>
        ) : preview.data ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-surface-2 px-3.5 py-1.5 text-[13px]">
              {(affectedStageKeys.length ? affectedStageKeys : [stageKey ?? '']).map((key, i) => (
                <div key={key} className="flex items-center gap-2.5 border-t py-2 first:border-t-0">
                  <span
                    className={
                      i === 0
                        ? 'size-2 rounded-full bg-run'
                        : 'size-2 rounded-full border-[1.5px] border-dashed border-faint'
                    }
                  />
                  <span className="flex-1">
                    {key === stageKey ? (stageLabel ?? key) : key}
                    {i === 0 && items === 'failed' && itemNumbers.length > 0
                      ? `, item${itemNumbers.length === 1 ? '' : 's'} ${itemNumbers.join(', ')}`
                      : ''}
                  </span>
                  <span className="text-faint">{i === 0 ? 'runs now' : 'runs again after'}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-6 text-[13px]">
              <span>
                <span className="text-faint">Spent so far</span>{' '}
                <b className="font-mono font-medium">${preview.data.spentUsd.toFixed(2)}</b>
              </span>
              <span>
                <span className="text-faint">This retry</span>{' '}
                <b className="font-mono font-medium">
                  about ${preview.data.estimatedRerunUsd.toFixed(2)}
                </b>
              </span>
            </div>
          </div>
        ) : null}

        {confirm.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not confirm retry</AlertTitle>
            <AlertDescription>
              {describeRunActionError(confirm.error, 'The retry could not be confirmed.')}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!preview.data || confirm.isPending} onClick={() => confirm.mutate()}>
            {confirm.isPending ? <Loader2 className="animate-spin" /> : null}
            {items === 'failed' ? 'Retry failed items' : 'Run again'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
