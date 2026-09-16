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
