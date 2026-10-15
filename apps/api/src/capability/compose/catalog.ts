import { AssetCatalog, VectorAssetSet } from '@reelcraft/shared';
import type { CatalogAsset, CatalogKind } from '@reelcraft/shared';

/** The assets a plan can name. An id only has to be unique among assets of its kind: a drawing and
 * a sound can both be called `pop`, and the kind of layer says which one a plan means. */
export class AssetIndex {
  private readonly byKey = new Map<string, CatalogAsset>();
  private static key(kind: CatalogKind, id: string) {
    return `${kind}\u0000${id}`;
  }
  static from(assets: Iterable<CatalogAsset>): AssetIndex {
    const index = new AssetIndex();
    for (const asset of assets) index.add(asset);
    return index;
  }
  /** False when an asset of that kind already has the id. */
  add(asset: CatalogAsset): boolean {
    const key = AssetIndex.key(asset.kind, asset.id);
    if (this.byKey.has(key)) return false;
    this.byKey.set(key, asset);
    return true;
  }
  get(kind: CatalogKind, id: string): CatalogAsset | undefined {
    return this.byKey.get(AssetIndex.key(kind, id));
  }
  /** Any asset with the id, whatever its kind (to say what it is when the kind is wrong). */
  find(id: string): CatalogAsset | undefined {
    return [...this.byKey.values()].find((asset) => asset.id === id);
  }
  ofKind(kind: CatalogKind): CatalogAsset[] {
    return [...this.byKey.values()].filter((asset) => asset.kind === kind);
  }
  values(): CatalogAsset[] {
    return [...this.byKey.values()];
  }
  get size(): number {
    return this.byKey.size;
  }
}

const KIND_OF_MEDIA: Record<string, CatalogKind> = {
  'media.image': 'image',
  'media.video': 'video',
  'media.audio': 'audio',
};

const durationOf = (manifest: Record<string, unknown>): number | undefined => {
  const probe = manifest.probe as { durationSec?: unknown } | undefined;
  const sec = typeof manifest.durationSec === 'number' ? manifest.durationSec : probe?.durationSec;
  return typeof sec === 'number' && sec > 0 ? sec : undefined;
};

/** The slot every Compose Timeline has for assets; others are named in its settings. */
export const GENERAL_ASSET_SLOT = 'assets';

/**
 * Everything a plan can name, gathered from what is bound to a stage: catalogues (from the
 * channel library or any stage that lists assets), sets of drawings, and plain pictures, clips and
 * sounds. A file with a name of its own (an uploaded one) keeps it. Any other file takes the name
 * of the slot it came in by, or `<slot>-1`, `<slot>-2` when the slot holds several; in the general
 * `assets` slot it is called `image-1`, `audio-2`, and so on, by its place among files of its kind.
 */
export function buildCatalog(inputs: ReadonlyArray<{ slot: string; value: unknown }>): {
  assets: AssetIndex;
  problems: string[];
} {
  const assets = new AssetIndex();
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  // How many files each slot holds, to name one file after its slot and several `<slot>-n`.
  const filesIn = (value: unknown): number =>
    Array.isArray(value) ? value.reduce<number>((total, v) => total + filesIn(v), 0) : 1;
  const add = (asset: CatalogAsset) => {
    if (!assets.add(asset)) {
      problems.push(`two ${asset.kind} assets are called "${asset.id}"; ids must be unique`);
    }
  };
  const visit = (value: unknown, slot: string, held: number): void => {
    if (Array.isArray(value)) return value.forEach((v) => visit(v, slot, held));
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const catalog = AssetCatalog.safeParse(record);
    if (
      catalog.success &&
      Array.isArray(record.assets) &&
      record.assets.every((a) => (a as { kind?: unknown }).kind !== undefined)
    ) {
      catalog.data.assets.forEach(add);
      return;
    }
    const set = VectorAssetSet.safeParse(record);
    if (set.success) {
      for (const vector of set.data.assets) {
        add({
          id: vector.id,
          kind: 'vector',
          label: vector.label,
          vector,
          source: vector.source === 'builtin' ? 'builtin' : 'generated',
        });
      }
      return;
    }
    const kind = typeof record.kind === 'string' ? KIND_OF_MEDIA[record.kind] : undefined;
    if (kind && typeof record.handle === 'string') {
      const named = typeof record.name === 'string' && record.name ? record.name : undefined;
      const key = slot === GENERAL_ASSET_SLOT ? kind : slot;
      counts[key] = (counts[key] ?? 0) + 1;
      const duration = durationOf(record);
      const generic = slot === GENERAL_ASSET_SLOT || held > 1 ? `${key}-${counts[key]}` : slot;
      add({
        id: named ?? generic,
        kind,
        handle: record.handle,
        ...(duration !== undefined && { durationSec: duration }),
        ...(named && { label: named }),
        source: record.handle.startsWith('asset:')
          ? 'library'
          : record.handle.startsWith('builtin:')
            ? 'builtin'
            : 'generated',
      });
      return;
    }
    problems.push('an input to Compose Timeline is not an asset, a catalogue or a set of drawings');
  };
  for (const { slot, value } of inputs) visit(value, slot, filesIn(value));
  return { assets, problems };
}
