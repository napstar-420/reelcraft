import { Injectable } from '@nestjs/common';

/**
 * §6.3 — stub for phase 4. The call site is placed inside
 * ArtifactService.finalize()'s transaction now (per the design: memory
 * writes are applied "in the same transaction that finalizes a passing
 * attempt and flips its artifact's stale to false") so the transaction
 * boundary does not move when phase 4 fills this in.
 */
@Injectable()
export class MemoryService {
  async applyWrites(
    _stageKey: string,
    _itemIndex: number | undefined,
    _artifactId: string,
  ): Promise<void> {
    // no-op in phase 1 — no StageDef in this phase declares `writes`.
  }
}
