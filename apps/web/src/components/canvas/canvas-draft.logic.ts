import type { BlueprintDto, CreateBlueprintVersionDto } from '@reelcraft/shared';

/**
 * The cached blueprint after the canvas saved, restored, discarded or
 * autosaved. The canvas loads its draft from this cache, so leaving the old
 * `workingDraft` in it lets a later visit (the cache outlives the page for
 * minutes) load, and then autosave, edits the latest save already replaced.
 */
export function withWorkingDraft(
  blueprint: BlueprintDto | undefined,
  workingDraft: CreateBlueprintVersionDto | null,
  currentVersionId?: string,
): BlueprintDto | undefined {
  if (!blueprint) return blueprint;
  return {
    ...blueprint,
    workingDraft,
    ...(currentVersionId !== undefined && { currentVersionId }),
  };
}
