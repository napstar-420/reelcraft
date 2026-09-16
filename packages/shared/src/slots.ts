import { z } from 'zod';
import { ArtifactKind } from './primitives';
import { JsonSchema } from './json-schema';

/** Capability-declared, typed input (§6.4). */
export const SlotDef = z.object({
  name: z.string(),
  accepts: z.array(z.union([ArtifactKind, JsonSchema])),
  required: z.boolean(),
  cardinality: z.enum(['one', 'many']),
});
export type SlotDef = z.infer<typeof SlotDef>;

/** A Blueprint-level declared run input (§3.6). */
export const InputDef = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  accepts: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text') }),
    z.object({ kind: z.literal('data'), schema: JsonSchema }),
    z.object({
      kind: z.enum(['media.image', 'media.video', 'media.audio']),
      cardinality: z.enum(['one', 'many']),
    }),
  ]),
});
export type InputDef = z.infer<typeof InputDef>;
