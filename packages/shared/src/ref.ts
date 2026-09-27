import { z } from 'zod';

/**
 * Refs points to values / blobs, and are not data themselves, they describe where to look
 */
export type Ref =
  | { from: 'prev'; path?: string | undefined; alignWith?: 'item' | undefined }
  | { from: 'memory'; key: string; path?: string | undefined }
  | { from: 'input'; inputKey: string; index?: number | undefined; path?: string | undefined }
  | { from: 'asset'; assetId: string }
  | { from: 'role'; roleKey: string }
  | { from: 'item'; path?: string | undefined }
  | { from: 'prevItem'; path?: string | undefined }
  | { from: 'const'; value?: unknown }
  /** Tries each of `refs` in order and resolves to the first one whose
   * resolved value is not `undefined` (e.g. `{from:'prevItem'}` at item 0).
   * Every branch must resolve to the same kind — mixing kinds is a save-time
   * validation error, not a run-time surprise. */
  | { from: 'coalesce'; refs: Ref[] };

export const Ref: z.ZodType<Ref> = z.discriminatedUnion('from', [
  z.object({
    from: z.literal('prev'),
    path: z.string().optional(),
    alignWith: z.literal('item').optional(),
  }),
  z.object({ from: z.literal('memory'), key: z.string(), path: z.string().optional() }),
  z.object({
    from: z.literal('input'),
    inputKey: z.string(),
    index: z.number().optional(),
    path: z.string().optional(),
  }),
  z.object({ from: z.literal('asset'), assetId: z.string() }),
  z.object({ from: z.literal('role'), roleKey: z.string() }),
  z.object({ from: z.literal('item'), path: z.string().optional() }),
  z.object({ from: z.literal('prevItem'), path: z.string().optional() }),
  z.object({ from: z.literal('const'), value: z.unknown() }),
  z.object({
    from: z.literal('coalesce'),
    refs: z.array(z.lazy(() => Ref)).min(2),
  }),
]);
