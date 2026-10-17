import type { RunDetailDto } from '@reelcraft/shared';
import { MemoryBrowser } from './memory-browser';
export function RunMemoryCard({
  run,
  onOpenStage,
}: {
  run: RunDetailDto;
  onOpenStage: (key: string) => void;
}) {
  return <MemoryBrowser runId={run.id} onOpenStage={onOpenStage} />;
}
