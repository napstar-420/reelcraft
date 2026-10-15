import { BUILTIN_AUDIO, builtinAudioHandle } from '@reelcraft/shared';
import type { CatalogAsset, LibraryKind } from '@reelcraft/shared';
import { ASSET_DEFS } from '../capability/vector/asset-data';

const GRID = { width: 100, height: 100 } as const;

/**
 * What ships with Reelcraft, listed like anything a channel uploaded: drawings and sound effects.
 * Built-in assets are ordinary library assets that happen to come with the product, so a plan
 * picks them the same way.
 */
export function builtinCatalog(kind: LibraryKind): CatalogAsset[] {
  if (kind === 'vector') {
    return ASSET_DEFS.map((def) => ({
      id: def.id,
      kind: 'vector' as const,
      label: def.label,
      tags: [...def.tags],
      source: 'builtin' as const,
      vector: {
        id: def.id,
        label: def.label,
        viewBox: { ...GRID },
        strokes: def.strokes,
        source: 'builtin' as const,
      },
    }));
  }
  if (kind === 'audio') {
    return BUILTIN_AUDIO.map((sound) => ({
      id: sound.id,
      kind: 'audio' as const,
      label: `${sound.label}: ${sound.description}`,
      tags: [...sound.tags],
      handle: builtinAudioHandle(sound.id),
      durationSec: sound.durationSec,
      source: 'builtin' as const,
    }));
  }
  return [];
}
