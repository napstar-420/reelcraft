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

/** Stages whose key doesn't start with the kind of model they use. */
const MODALITY_OF: Record<string, Modality> = {
  // A text model writes the code; the key is about what it makes.
  'motion.generate': 'text',
};

export function modalityForCapability(capability: string): Modality {
  const named = MODALITY_OF[capability];
  if (named) return named;
  const prefix = capability.split('.')[0] as Modality | undefined;
  return prefix && MODALITIES.has(prefix) ? prefix : 'compute';
}
