import { useState } from 'react';
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
import { formatOffset, stageLogLines, type StageLogLine } from '@/lib/stage-logs';
import { cn } from '@/lib/utils';

export function StageAttemptsSheet({
  runId,
  stageKey,
  stageRunning,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  stageRunning: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [showDebug, setShowDebug] = useState(false);
  const refetchInterval = stageRunning ? 3000 : false;
  const attempts = useQuery({
    queryKey: ['stage-attempts', runId, stageKey],
    queryFn: () => api.listStageAttempts(runId, stageKey as string),
    enabled: open && Boolean(stageKey),
    refetchInterval,
  });
  const logs = useQuery({
    queryKey: ['stage-logs', runId, stageKey],
    queryFn: () => api.listStageLogs(runId, stageKey as string),
    enabled: open && Boolean(stageKey),
    refetchInterval,
  });
  const stageLevelLines = stageLogLines(logs.data ?? [], null, showDebug);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Attempts for {stageKey}</SheetTitle>
          <SheetDescription>
            Every attempt this stage has made, most recent first, with its log.
          </SheetDescription>
          <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(event) => setShowDebug(event.target.checked)}
            />
            Show debug events
          </label>
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
              {stageLevelLines.length > 0 ? (
                <div className="rounded-lg border p-3">
                  <span className="font-medium">Stage</span>
                  <StageLog lines={stageLevelLines} defaultOpen />
                </div>
              ) : null}
              {[...(attempts.data ?? [])]
                .sort((a, b) => b.attemptNo - a.attemptNo)
                .map((attempt, index) => (
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
                    <StageLog
                      lines={stageLogLines(logs.data ?? [], attempt.id, showDebug)}
                      defaultOpen={index === 0}
                    />
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

const LEVEL_CLASS: Record<StageLogLine['level'], string> = {
  debug: 'text-muted-foreground',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

function StageLog({ lines, defaultOpen }: { lines: StageLogLine[]; defaultOpen: boolean }) {
  if (lines.length === 0) return null;
  return (
    <details className="mt-2 rounded-md border" open={defaultOpen}>
      <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">
        Logs ({lines.length})
      </summary>
      <ol className="flex flex-col divide-y border-t font-mono text-xs">
        {lines.map((line) => (
          <li key={line.id} className="px-2 py-1.5">
            <div className="flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">
                {formatOffset(line.offsetMs)}
              </span>
              <span className={cn('w-10 shrink-0 uppercase', LEVEL_CLASS[line.level])}>
                {line.level}
              </span>
              <span className="min-w-0 flex-1 break-words">{line.message}</span>
            </div>
            {line.data !== null ? (
              <details className="ml-26 mt-1">
                <summary className="cursor-pointer text-muted-foreground">{line.type}</summary>
                <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2">
                  {JSON.stringify(line.data, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
