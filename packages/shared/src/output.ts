import { z } from 'zod';
import { JsonSchema } from './json-schema';

export const MediaConstraints = z.object({
  durationSec: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  aspectRatio: z.string().optional(),
  minWidth: z.number().optional(),
  /** Video/audio policy. Omitted is intentionally resolved by video.generate
   * to `required`; other media capabilities ignore it. */
  audio: z.enum(['required', 'optional', 'forbidden']).optional(),
});
export type MediaConstraints = z.infer<typeof MediaConstraints>;

/** §4.2 — the seven closed artifact kinds a Stage may declare as its output. */
export const OutputDef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('data'), schema: JsonSchema, schemaName: z.string().optional() }),
  z.object({ kind: z.literal('text') }),
  z.object({
    kind: z.enum(['media.image', 'media.video', 'media.audio']),
    constraints: MediaConstraints.optional(),
  }),
  z.object({ kind: z.literal('file.subtitles') }),
  z.object({ kind: z.literal('timeline') }),
]);
export type OutputDef = z.infer<typeof OutputDef>;
