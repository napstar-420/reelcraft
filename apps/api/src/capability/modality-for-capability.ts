import type { Modality } from '@reelcraft/shared';

const MODALITIES = new Set<Modality>([
  'text',
  'image',
  'video',
  'audio',
  'media',
  'browser',
  'human',
  'publish',
]);

export function modalityForCapability(capability: string): Modality {
  const prefix = capability.split('.')[0] as Modality | undefined;
  return prefix && MODALITIES.has(prefix) ? prefix : 'compute';
}
