import { z } from 'zod';

/** §3.2 — persistent identity asset reference material. */
export const ReferenceImage = z.object({
  blobId: z.string(),
  view: z.enum(['front', 'three_quarter', 'profile', 'full_body', 'expression', 'detail']),
  caption: z.string().optional(),
  origin: z.enum(['uploaded', 'generated']),
  sourceArtifactId: z.string().optional(),
  order: z.number(),
});
export type ReferenceImage = z.infer<typeof ReferenceImage>;

export const ReferencePolicy = z.object({
  maxRefs: z.number(),
  prefer: z.array(ReferenceImage.shape.view),
  alwaysIncludePrimary: z.boolean(),
});
export type ReferencePolicy = z.infer<typeof ReferencePolicy>;
