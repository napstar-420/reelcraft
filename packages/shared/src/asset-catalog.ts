import { z } from 'zod';
import { VectorAsset } from './vector-asset';

/** What an asset is. Every kind can be made during a run or uploaded to the channel library. */
export const CatalogKind = z.enum(['image', 'video', 'audio', 'vector', 'font', 'model']);
export type CatalogKind = z.infer<typeof CatalogKind>;

/**
 * One asset a video can use, named so a model can pick it and a stage can find it. Whatever its
 * kind and wherever it came from (made in the run, uploaded to the channel library, or built into
 * Reelcraft), it is listed the same way.
 */
export const CatalogAsset = z.object({
  /** What a plan calls it. Unique within a catalogue. */
  id: z.string().min(1).max(100),
  kind: CatalogKind,
  label: z.string().max(200).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  /** How a timeline names a file asset (`artifact:...`, `asset:...`, `builtin:...`). */
  handle: z.string().min(1).max(300).optional(),
  /** How long an audio or video asset is. */
  durationSec: z.number().nonnegative().optional(),
  /** A vector asset is the drawing itself. */
  vector: VectorAsset.optional(),
  /** A font's family name, which words name to use it. */
  family: z.string().min(1).max(80).optional(),
  source: z.enum(['generated', 'library', 'builtin']).optional(),
});
export type CatalogAsset = z.infer<typeof CatalogAsset>;

export const AssetCatalog = z.object({
  assets: z.array(CatalogAsset).max(500),
});
export type AssetCatalog = z.infer<typeof AssetCatalog>;

/** The catalogue as text for a model's prompt: one line per asset. */
export function describeCatalog(catalog: AssetCatalog): string {
  return catalog.assets
    .map((asset) => {
      const bits = [
        `${asset.id} (${asset.kind})`,
        asset.label,
        asset.family !== undefined && asset.family !== asset.label
          ? `family ${asset.family}`
          : undefined,
        asset.durationSec !== undefined ? `${Math.round(asset.durationSec * 10) / 10}s` : undefined,
        asset.tags?.length ? `tags: ${asset.tags.join(', ')}` : undefined,
      ].filter(Boolean);
      return `- ${bits.join(' · ')}`;
    })
    .join('\n');
}
