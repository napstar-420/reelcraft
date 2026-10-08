import type { BlueprintDto, CreateBlueprintVersionDto } from '@reelcraft/shared';

/**
 * The cached blueprint after the canvas saved, restored, discarded or
 * autosaved. The canvas loads its draft from this cache, so leaving the old
 * `workingDraft` in it lets a later visit (the cache outlives the page for
 * minutes) load, and then autosave, edits the latest save already replaced.
 * `baseVersionId` is the saved version the written draft is based on.
 */
export function withWorkingDraft(
  blueprint: BlueprintDto | undefined,
  workingDraft: CreateBlueprintVersionDto | null,
  baseVersionId: string | null,
  currentVersionId?: string,
): BlueprintDto | undefined {
  if (!blueprint) return blueprint;
  return {
    ...blueprint,
    workingDraft,
    workingDraftBaseVersionId: workingDraft ? baseVersionId : null,
    ...(currentVersionId !== undefined && { currentVersionId }),
  };
}

/**
 * What the canvas opens with. The unsaved copy only belongs on the canvas
 * while it was made from the latest save (`null` base: none saved yet). Any
 * other copy, including an old one that never recorded its base, is handed
 * back as `orphan` for the user to open or discard, never loaded over a
 * newer save and never dropped silently.
 */
export function pickInitialDraft({
  latestSavedId,
  working,
  workingBaseId,
}: {
  latestSavedId: string | null;
  working: CreateBlueprintVersionDto | null;
  workingBaseId: string | null;
}): { draft: 'working' | 'saved'; orphan?: CreateBlueprintVersionDto } {
  if (!working) return { draft: 'saved' };
  if (workingBaseId === latestSavedId) return { draft: 'working' };
  return { draft: 'saved', orphan: working };
}

/**
 * The newest saved version when it is newer than the one the canvas is based
 * on, else null. `versions` is newest first, as the API lists them. Ordered by
 * number rather than id, so the list's stale copy right after this canvas's own
 * save (older than what it just saved) is not mistaken for someone else's save.
 */
export function newerSaved<V extends { major: number; minor: number }>(
  based: { major: number; minor: number } | null,
  versions: V[] | undefined,
): V | null {
  const newest = versions?.[0];
  if (!newest) return null;
  if (!based) return newest;
  const newer =
    newest.major > based.major || (newest.major === based.major && newest.minor > based.minor);
  return newer ? newest : null;
}

/** The API's 409 `blueprint_changed`: the write was based on a saved version
 * that is no longer the blueprint's current one. */
export function blueprintChanged(error: unknown): { currentVersionId: string | null } | null {
  const e = error as { status?: unknown; issues?: unknown } | null;
  const body = e?.issues as { code?: unknown; currentVersionId?: unknown } | undefined;
  if (e?.status !== 409 || body?.code !== 'blueprint_changed') return null;
  return {
    currentVersionId: typeof body.currentVersionId === 'string' ? body.currentVersionId : null,
  };
}

/** The API's 400 for a working-draft write without `baseVersionId`: this page's
 * code predates the server's stale-write guard (a tab opened before an update). */
export function outdatedEditor(error: unknown): boolean {
  const e = error as { status?: unknown; issues?: unknown } | null;
  return (
    e?.status === 400 &&
    Array.isArray(e.issues) &&
    e.issues.some((issue) => (issue as { path?: unknown[] } | null)?.path?.[0] === 'baseVersionId')
  );
}
