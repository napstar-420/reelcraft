import type { AssetKind } from '@reelcraft/shared';
import { isModelExtension } from '../artifact/model-file';
import { FONT_EXTENSIONS } from './font-file';

/** The Library kind a file is, from its type and extension; null when it isn't one. */
export function assetKindFor(mime: string, ext: string): AssetKind | null {
  const type = mime.toLowerCase();
  const e = ext.toLowerCase();
  if (type === 'image/svg+xml' || e === 'svg') return 'vector';
  if (FONT_EXTENSIONS.has(e)) return 'font';
  if (isModelExtension(e)) return 'model';
  if (type.startsWith('image/')) return 'media.image';
  if (type.startsWith('video/')) return 'media.video';
  if (type.startsWith('audio/')) return 'media.audio';
  return null;
}
