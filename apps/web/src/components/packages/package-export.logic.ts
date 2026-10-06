import type { PackageReferenceDto } from '@reelcraft/shared';

export type MediaChoice = 'bundle' | 'slot';

/** Whether the exporter may ship this reference's media at all. */
export function canBundle(ref: PackageReferenceDto): boolean {
  return !ref.missing && !ref.tooLarge;
}

/** What the user picked, defaulting to bundling whatever can be bundled. */
export function choiceFor(
  ref: PackageReferenceDto,
  picked: Record<string, MediaChoice>,
): MediaChoice {
  return canBundle(ref) ? (picked[ref.id] ?? 'bundle') : 'slot';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a reference can only become an empty slot, or null. */
export function slotOnlyReason(ref: PackageReferenceDto): string | null {
  if (ref.missing) return 'No longer available, so the importer fills it.';
  if (ref.tooLarge) return 'Too large to include, so the importer fills it.';
  return null;
}
