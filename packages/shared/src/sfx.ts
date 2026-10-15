import type { Probe } from './probe';

/** Handles that name a sound effect built into Reelcraft look like `sfx:pop`. They need no file in
 * storage: the sound ships with the video composition, so a render and the editor preview play the
 * same thing. */
export const SFX_PREFIX = 'sfx:';

export interface SfxInfo {
  id: string;
  label: string;
  /** What it sounds like, for a prompt or a picker. */
  description: string;
  durationSec: number;
}

/** The sound effects that ship with Reelcraft. Each is a short WAV made by
 * `packages/timeline-composition/scripts/make-sfx.mjs`; a test keeps this list and the files in step. */
export const SFX_CATALOG: readonly SfxInfo[] = [
  {
    id: 'pencil',
    label: 'Pencil scratch',
    description: 'Short scratches of a pencil on paper',
    durationSec: 0.55,
  },
  {
    id: 'marker',
    label: 'Marker squeak',
    description: 'The squeak of a marker writing',
    durationSec: 0.7,
  },
  { id: 'pop', label: 'Pop', description: 'A soft bubble pop', durationSec: 0.2 },
  {
    id: 'whoosh',
    label: 'Whoosh',
    description: 'Air moving past, rising and fading',
    durationSec: 0.65,
  },
  { id: 'paper', label: 'Paper crinkle', description: 'Paper being moved', durationSec: 0.5 },
  { id: 'click', label: 'Click', description: 'A small click', durationSec: 0.06 },
  {
    id: 'ding',
    label: 'Ding',
    description: 'A bright bell ding, for a right answer',
    durationSec: 0.9,
  },
  { id: 'tick', label: 'Tick', description: 'A clock tick', durationSec: 0.05 },
  { id: 'swipe', label: 'Swipe', description: 'A quick swipe, high to low', durationSec: 0.35 },
  {
    id: 'sparkle',
    label: 'Sparkle',
    description: 'A glittering run of high notes',
    durationSec: 0.75,
  },
  {
    id: 'thud',
    label: 'Thud',
    description: 'A soft thump, for something landing',
    durationSec: 0.3,
  },
  {
    id: 'chime',
    label: 'Chime',
    description: 'A gentle two-note chime, for a result',
    durationSec: 1.2,
  },
];

export const isSfxHandle = (handle: string): boolean => handle.startsWith(SFX_PREFIX);

export const sfxIdOf = (handle: string): string => handle.slice(SFX_PREFIX.length);

export const sfxInfo = (id: string): SfxInfo | undefined =>
  SFX_CATALOG.find((sfx) => sfx.id === id);

export const sfxHandle = (id: string): string => `${SFX_PREFIX}${id}`;

/** A stand-in for what probing the file would say, so checks that read a clip's length can treat a
 * built-in sound like any other audio. */
export function sfxProbe(id: string): Probe | undefined {
  const info = sfxInfo(id);
  return info
    ? {
        container: 'wav',
        durationSec: info.durationSec,
        streams: [{ type: 'audio', codec: 'pcm_s16le', sampleRate: 22050 }],
      }
    : undefined;
}
