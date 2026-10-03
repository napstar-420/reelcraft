import type { AssetKind } from '@reelcraft/shared';

/** Readable names for asset kinds, shown on asset cards and filters. */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  'media.image': 'Image',
  'media.video': 'Video',
  'media.audio': 'Audio',
  font: 'Font',
  lut: 'LUT',
};

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  fal: 'fal',
  elevenlabs: 'ElevenLabs',
  deepgram: 'Deepgram',
  fake: 'Fake (test)',
};

/** A provider id as people know it ("openrouter" → "OpenRouter"). Unknown ids
 * are shown as they are. */
export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}
