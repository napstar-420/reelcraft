import type { ArtifactKind } from '@reefcraft/shared';

/** A text artifact stores its content wrapped as `{text: string}`; unwrap
 * down to the plain string. Other kinds pass through unchanged. Shared by
 * `BindingResolverService` (template/slot binding) and `CheckRunner`'s
 * `CheckArtifact` construction, so "what a text artifact's data means"
 * can't drift between the two. */
export function unwrapText(kind: ArtifactKind, data: unknown): unknown {
  if (kind === 'text' && data && typeof data === 'object' && 'text' in data) {
    return (data as { text: unknown }).text;
  }
  return data;
}
