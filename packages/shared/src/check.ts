import { z } from 'zod';
import { Ref } from './ref';

/** §9.1 — all Checks are pure, synchronous, and perform no I/O. */
export const CheckDef = z.discriminatedUnion('type', [
  z.object({ type: z.literal('builtin'), key: z.string(), params: z.unknown() }),
  z.object({
    type: z.literal('script'),
    name: z.string(),
    code: z.string(),
    refs: z.record(z.string(), Ref).optional(),
  }),
]);
export type CheckDef = z.infer<typeof CheckDef>;
