import { z } from 'zod';

/** §4.3 — small data shapes associated with StorageAdapter; the adapter
 * interface itself is behavioral and lives in apps/api. */
export const PutResult = z.object({
  key: z.string(),
  etag: z.string(),
  bytes: z.number(),
});
export type PutResult = z.infer<typeof PutResult>;

/** HTTP Range semantics — `end` is inclusive. */
export const ByteRange = z.object({
  start: z.number(),
  end: z.number().optional(),
});
export type ByteRange = z.infer<typeof ByteRange>;
