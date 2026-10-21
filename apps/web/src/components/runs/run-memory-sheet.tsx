import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { MemoryBrowser } from './memory-browser';

/** Everything the run's stages have written so far, which later stages read from. */
export function RunMemorySheet({
  runId,
  open,
  onOpenChange,
  onOpenStage,
  labelOf,
}: {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenStage: (key: string) => void;
  labelOf: (key: string) => string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-lg">Memory</SheetTitle>
          <SheetDescription>
            Everything stages have written so far. Later stages read from here.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <MemoryBrowser
            runId={runId}
            labelOf={labelOf}
            onOpenStage={(key) => {
              onOpenChange(false);
              onOpenStage(key);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
