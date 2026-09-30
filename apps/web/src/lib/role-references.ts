import type { CharacterDto } from '@reelcraft/shared';

/** A role's selected reference images, kept valid against its Character:
 * ids the Character no longer has are dropped, and an empty selection falls
 * back to the primary image (or the first, when no primary is set). Returns
 * `[]` only when the Character has no references at all. */
export function normalizeRoleReferences(
  selected: readonly string[],
  character: Pick<CharacterDto, 'referenceSet' | 'primaryRefId'>,
): string[] {
  const owned = new Set(character.referenceSet.map((ref) => ref.blobId));
  const kept = selected.filter((id) => owned.has(id));
  if (kept.length > 0) return kept;
  const fallback =
    character.primaryRefId && owned.has(character.primaryRefId)
      ? character.primaryRefId
      : [...character.referenceSet].sort((a, b) => a.order - b.order)[0]?.blobId;
  return fallback ? [fallback] : [];
}
