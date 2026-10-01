import { z } from 'zod';

/** `GET /api/system/health` — the container healthcheck and, later, the
 * updater's post-switch probe. */
export const SystemHealthDto = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type SystemHealthDto = z.infer<typeof SystemHealthDto>;
