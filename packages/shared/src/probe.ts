import { z } from 'zod';

/** §9.3 — media metadata populated at write time; manifests (§6.6) derive from this. */
export const Probe = z.object({
  container: z.string(),
  durationSec: z.number(),
  streams: z.array(
    z.object({
      type: z.enum(['video', 'audio']),
      codec: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      fps: z.number().optional(),
      sampleRate: z.number().optional(),
    }),
  ),
});
export type Probe = z.infer<typeof Probe>;

/** A provider result never carries media bytes through the orchestration
 * payload. The runner streams this source into durable object storage. */
export const MediaSource = z.object({
  kind: z.enum(['media.image', 'media.video', 'media.audio']),
  sourceUrl: z.string().url().optional(),
  base64: z.string().optional(),
  mime: z.string().optional(),
  filename: z.string().optional(),
});
export type MediaSource = z.infer<typeof MediaSource>;

export const MediaManifest = z.object({
  handle: z.string(),
  kind: z.enum(['media.image', 'media.video', 'media.audio']),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  hasAudio: z.boolean(),
});
export type MediaManifest = z.infer<typeof MediaManifest>;

export const TimingMap = z.object({
  transcript: z.string(),
  language: z.string().optional(),
  durationSec: z.number(),
  sentences: z.array(z.object({ text: z.string(), startSec: z.number(), endSec: z.number() })),
  words: z.array(
    z.object({ text: z.string(), startSec: z.number(), endSec: z.number(), confidence: z.number().optional() }),
  ),
});
export type TimingMap = z.infer<typeof TimingMap>;
