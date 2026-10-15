import type { Probe } from './probe';

/** Handles that name audio built into Reelcraft look like `builtin:audio/pop`. They need no file
 * in storage: the sound ships with the video composition, so a render and the editor preview play
 * the same thing. In the library they are ordinary audio assets that happen to ship with Reelcraft. */
export const BUILTIN_AUDIO_PREFIX = 'builtin:audio/';

export interface BuiltinAudioInfo {
  id: string;
  label: string;
  /** What it sounds like, for a prompt or a picker. */
  description: string;
  /** What it is for, so a model or a person can find it. */
  tags: readonly string[];
  durationSec: number;
}

/** The sound effects that ship with Reelcraft. Each is a short WAV made by
 * `packages/timeline-composition/scripts/make-sfx.mjs`; a test keeps this list and the files in step. */
export const BUILTIN_AUDIO: readonly BuiltinAudioInfo[] = [
  {
    id: 'pencil',
    label: 'Pencil scratch',
    description: 'Short scratches of a pencil on paper',
    tags: ['sfx', 'drawing', 'writing'],
    durationSec: 0.55,
  },
  {
    id: 'marker',
    label: 'Marker squeak',
    description: 'The squeak of a marker writing',
    tags: ['sfx', 'writing'],
    durationSec: 0.7,
  },
  {
    id: 'pop',
    label: 'Pop',
    description: 'A soft bubble pop',
    tags: ['sfx', 'appear'],
    durationSec: 0.2,
  },
  {
    id: 'whoosh',
    label: 'Whoosh',
    description: 'Air moving past, rising and fading',
    tags: ['sfx', 'transition', 'movement'],
    durationSec: 0.65,
  },
  {
    id: 'paper',
    label: 'Paper crinkle',
    description: 'Paper being moved',
    tags: ['sfx', 'paper'],
    durationSec: 0.5,
  },
  {
    id: 'click',
    label: 'Click',
    description: 'A small click',
    tags: ['sfx', 'interface'],
    durationSec: 0.06,
  },
  {
    id: 'ding',
    label: 'Ding',
    description: 'A bright bell ding, for a right answer',
    tags: ['sfx', 'result', 'success'],
    durationSec: 0.9,
  },
  {
    id: 'tick',
    label: 'Tick',
    description: 'A clock tick',
    tags: ['sfx', 'clock', 'interface'],
    durationSec: 0.05,
  },
  {
    id: 'swipe',
    label: 'Swipe',
    description: 'A quick swipe, high to low',
    tags: ['sfx', 'transition'],
    durationSec: 0.35,
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    description: 'A glittering run of high notes',
    tags: ['sfx', 'magic', 'success'],
    durationSec: 0.75,
  },
  {
    id: 'thud',
    label: 'Thud',
    description: 'A soft thump, for something landing',
    tags: ['sfx', 'impact'],
    durationSec: 0.3,
  },
  {
    id: 'chime',
    label: 'Chime',
    description: 'A gentle two-note chime, for a result',
    tags: ['sfx', 'result', 'notification'],
    durationSec: 1.2,
  },
];

export const isBuiltinAudioHandle = (handle: string): boolean =>
  handle.startsWith(BUILTIN_AUDIO_PREFIX);

export const builtinAudioIdOf = (handle: string): string =>
  handle.slice(BUILTIN_AUDIO_PREFIX.length);

export const builtinAudioInfo = (id: string): BuiltinAudioInfo | undefined =>
  BUILTIN_AUDIO.find((sfx) => sfx.id === id);

export const builtinAudioHandle = (id: string): string => `${BUILTIN_AUDIO_PREFIX}${id}`;

/** A stand-in for what probing the file would say, so checks that read a clip's length can treat a
 * built-in sound like any other audio. */
export function builtinAudioProbe(id: string): Probe | undefined {
  const info = builtinAudioInfo(id);
  return info
    ? {
        container: 'wav',
        durationSec: info.durationSec,
        streams: [{ type: 'audio', codec: 'pcm_s16le', sampleRate: 22050 }],
      }
    : undefined;
}
