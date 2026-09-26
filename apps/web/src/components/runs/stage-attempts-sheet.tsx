import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { attemptOutcomeTone, formatStatusLabel } from '@/lib/status';
import { describeRunActionError } from '@/lib/describe-run-action-error';

export function StageAttemptsSheet({
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
  const attempts = useQuery({
    queryKey: ['stage-attempts', runId, stageKey],
    queryFn: () => api.listStageAttempts(runId, stageKey as string),
    enabled: open && Boolean(stageKey),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Attempts for {stageKey}</SheetTitle>
          <SheetDescription>Every attempt this stage has made, most recent first.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          {attempts.isLoading ? (
            <div className="flex flex-col gap-3 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : attempts.isError ? (
            <Alert variant="destructive" className="my-4">
              <AlertTitle>Could not load attempts</AlertTitle>
              <AlertDescription>
                {describeRunActionError(attempts.error, 'The attempt history failed to load.')}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-3 py-4">
              {[...(attempts.data ?? [])]
                .sort((a, b) => b.attemptNo - a.attemptNo)
                .map((attempt) => (
                  <div key={attempt.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Attempt {attempt.attemptNo}</span>
                        <StatusBadge
                          tone={attemptOutcomeTone(attempt.outcome)}
                          label={formatStatusLabel(attempt.outcome)}
                        />
                        <span className="text-xs text-muted-foreground">{attempt.actor}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        ${attempt.costUsd.toFixed(4)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(attempt.createdAt).toLocaleString()}
                    </p>
                    {attempt.reviewNote ? (
                      <p className="mt-2 text-sm">
                        <span className="font-medium">Review note: </span>
                        {attempt.reviewNote}
                      </p>
                    ) : null}
                    {attempt.renderedPrompt ||
                    attempt.checkResults !== null ||
                    attempt.qcVerdict !== null ? (
                      <details className="mt-2 rounded-md border p-2">
                        <summary className="cursor-pointer text-xs font-medium">Details</summary>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                          {JSON.stringify(
                            {
                              ...(attempt.renderedPrompt !== null
                                ? { prompt: attempt.renderedPrompt }
                                : {}),
                              ...(attempt.checkResults !== null
                                ? { checks: attempt.checkResults }
                                : {}),
                              ...(attempt.qcVerdict !== null ? { quality: attempt.qcVerdict } : {}),
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))}
              {attempts.data?.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No attempts yet.</p>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
