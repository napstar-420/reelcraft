import { ASSET_ID, VectorAsset } from '@reelcraft/shared';
import { LIBRARY_KINDS } from '@reelcraft/shared';
import type { AssetCatalog, CatalogAsset, LibraryKind } from '@reelcraft/shared';
import { builtinCatalog } from './builtin-library';

/** One channel asset as the run snapshotted it at start. */
export interface LibraryBinding {
  blobId: string;
  /** The asset kind: `media.image`, `media.audio`, `vector`, ... */
  kind: string;
  name?: string | undefined;
  tags?: string[] | undefined;
  /** What was read from an uploaded SVG: `{ viewBox, strokes }`. */
  vector?: unknown;
  /** Set when the asset was picked up by a `{from:'library'}` ref at run start. */
  inLibrary?: boolean | undefined;
}

export const ASSET_KIND_FOR_LIBRARY: Record<LibraryKind, string> = {
  image: 'media.image',
  video: 'media.video',
  audio: 'media.audio',
  vector: 'vector',
};

const slug = (name: string): string => {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return ASSET_ID.test(id) ? id : `drawing-${id || 'x'}`.slice(0, 64);
};

/**
 * The catalogue a `{from:'library'}` ref resolves to: the channel's assets of one kind that the
 * run snapshotted (every tag asked for, if any), then the built-in ones of that kind. An uploaded
 * asset takes the id of a built-in one with the same name. Pure, so the same snapshot always
 * lists the same assets.
 */
export function libraryCatalog(input: {
  kinds?: readonly LibraryKind[] | undefined;
  tags?: readonly string[] | undefined;
  builtin?: boolean | undefined;
  bindings: Readonly<Record<string, LibraryBinding>>;
  /** How long each file is, by asset id, from the stored probe. */
  durations?: Readonly<Record<string, number | undefined>> | undefined;
}): AssetCatalog {
  const wantKinds = input.kinds?.length ? input.kinds : LIBRARY_KINDS;
  const wantTags = input.tags ?? [];
  const hasTags = (tags: readonly string[] | undefined) =>
    wantTags.every((tag) => (tags ?? []).some((have) => have.toLowerCase() === tag.toLowerCase()));

  const assets: CatalogAsset[] = [];
  const taken = new Set<string>();
  for (const kind of wantKinds) {
    const wantKind = ASSET_KIND_FOR_LIBRARY[kind];
    const entries = Object.entries(input.bindings)
      .filter(([, binding]) => binding.inLibrary && binding.kind === wantKind && binding.name)
      .filter(([, binding]) => hasTags(binding.tags))
      .sort((a, b) => a[1].name!.localeCompare(b[1].name!));
    for (const [assetId, binding] of entries) {
      const name = binding.name!;
      if (taken.has(name)) continue;
      taken.add(name);
      const duration = input.durations?.[assetId];
      if (kind === 'vector') {
        const meta = binding.vector as { viewBox?: unknown; strokes?: unknown } | undefined;
        const vector = VectorAsset.safeParse({
          id: slug(name),
          label: name,
          viewBox: meta?.viewBox,
          strokes: meta?.strokes,
          source: 'library',
        });
        if (!vector.success) continue;
        assets.push({
          id: name,
          kind: 'vector',
          label: name,
          ...(binding.tags?.length && { tags: binding.tags }),
          vector: vector.data,
          source: 'library',
        });
        continue;
      }
      assets.push({
        id: name,
        kind,
        label: name,
        ...(binding.tags?.length && { tags: binding.tags }),
        handle: `asset:${assetId}`,
        ...(duration !== undefined && duration > 0 && { durationSec: duration }),
        source: 'library',
      });
    }
  }
  if (input.builtin !== false) {
    for (const kind of wantKinds) {
      for (const asset of builtinCatalog(kind)) {
        if (taken.has(asset.id) || !hasTags(asset.tags)) continue;
        assets.push(asset);
      }
    }
  }
  return { assets: assets.slice(0, 500) };
}
