import type { ModelCapabilities } from '@reelcraft/shared';

type Sound = NonNullable<ModelCapabilities['sound']>;

export interface ElevenLabsSoundSpec {
  name: string;
  sound: Sound;
}

/**
 * ElevenLabs sound-effect and music models. A list price per second of audio, used as the
 * budget ceiling: the bill depends on the plan.
 *
 * The request shapes below follow ElevenLabs' public documentation (`POST /v1/sound-generation`
 * and `POST /v1/music`) and have not been run against the live API from this repository's
 * build environment. A mismatch shows as the provider's own error message on the stage.
 */
export const ELEVENLABS_SOUND_MODELS: Record<string, ElevenLabsSoundSpec> = {
  eleven_text_to_sound_v2: {
    name: 'Sound Effects v2',
    sound: { kind: 'sfx', minSec: 0.5, maxSec: 22, usdPerSecond: 0.02 },
  },
  music_v1: {
    name: 'Music v1',
    sound: { kind: 'music', minSec: 3, maxSec: 600, usdPerSecond: 0.03 },
  },
};

export const SOUND_OUTPUT_FORMAT = 'mp3_44100_128';

/** Models in the same list shape as the speech models. */
export function soundModelInfos() {
  return Object.entries(ELEVENLABS_SOUND_MODELS).map(([modelId, spec]) => ({
    modelId,
    label: spec.name,
    modalities: ['audio' as const],
    capabilities: {
      supportsSeed: false,
      supportsIdempotency: false,
      sound: spec.sound,
    },
  }));
}

/** The seconds a request asks for, kept inside what the model takes. */
export function clampSoundSeconds(sound: Sound, requested: unknown): number {
  const fallback = sound.kind === 'sfx' ? 2 : 30;
  const sec = typeof requested === 'number' && Number.isFinite(requested) ? requested : fallback;
  return Math.min(sound.maxSec, Math.max(sound.minSec, sec));
}

export function soundCostUsd(sound: Sound, seconds: number): number {
  return Math.round(seconds * sound.usdPerSecond * 10_000) / 10_000;
}

/** The URL and JSON body for one generation. */
export function elevenLabsSoundRequest(args: {
  modelId: string;
  sound: Sound;
  prompt: string;
  seconds: number;
  promptInfluence?: number | undefined;
}): { url: string; body: Record<string, unknown> } {
  if (args.sound.kind === 'sfx') {
    return {
      url: `https://api.elevenlabs.io/v1/sound-generation?output_format=${SOUND_OUTPUT_FORMAT}`,
      body: {
        text: args.prompt,
        model_id: args.modelId,
        duration_seconds: Math.round(args.seconds * 10) / 10,
        ...(args.promptInfluence !== undefined && { prompt_influence: args.promptInfluence }),
      },
    };
  }
  return {
    url: `https://api.elevenlabs.io/v1/music?output_format=${SOUND_OUTPUT_FORMAT}`,
    body: {
      prompt: args.prompt,
      model_id: args.modelId,
      music_length_ms: Math.round(args.seconds * 1000),
      // Background music sits under a voice-over: no singing.
      force_instrumental: true,
    },
  };
}
