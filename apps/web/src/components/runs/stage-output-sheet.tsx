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
import { describeRunActionError } from '@/lib/describe-run-action-error';
import { ArtifactPreview } from './artifact-preview';

export function StageOutputSheet({
  runId,
  stageKey,
  stageLabel,
  stageRunning,
  open,
  onOpenChange,
}: {
  runId: string;
  stageKey: string | null;
  stageLabel?: string | null;
  stageRunning: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const output = useQuery({
    queryKey: ['stage-output', runId, stageKey],
    queryFn: () => api.getStageOutput(runId, stageKey as string),
    enabled: open && Boolean(stageKey),
  });
  const items = output.data?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Output of {stageLabel ?? stageKey}</SheetTitle>
          <SheetDescription>The current output this stage produced.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          {output.isLoading ? (
            <Skeleton className="my-4 h-40 w-full" />
          ) : output.isError ? (
            <Alert variant="destructive" className="my-4">
              <AlertTitle>Could not load output</AlertTitle>
              <AlertDescription>
                {describeRunActionError(output.error, 'The stage output failed to load.')}
              </AlertDescription>
            </Alert>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {stageRunning ? 'No output yet. This stage is still running.' : 'No output.'}
            </p>
          ) : (
            <div
              className={
                items.length > 1 && items.every((item) => item.artifact.kind === 'media.image')
                  ? 'grid grid-cols-2 gap-4 py-4'
                  : 'flex flex-col gap-6 py-4'
              }
            >
              {items.map((item) => (
                <section key={item.artifact.id} className="flex flex-col gap-2">
                  {item.itemIndex !== null ? (
                    <h3 className="text-sm font-medium">Item {item.itemIndex + 1}</h3>
                  ) : null}
                  <ArtifactPreview artifact={item.artifact} />
                </section>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
