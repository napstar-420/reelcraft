import { z } from 'zod';

export type LibraryKind = 'image' | 'video' | 'audio' | 'vector';
export const LIBRARY_KINDS = ['image', 'video', 'audio', 'vector'] as const;

/**
 * Refs points to values / blobs, and are not data themselves, they describe where to look
 */
export type Ref =
  | { from: 'prev'; path?: string | undefined; alignWith?: 'item' | undefined }
  /** The output of any earlier stage, by key (`prev` reads only the stage just before). */
  | { from: 'stage'; stageKey: string; path?: string | undefined; alignWith?: 'item' | undefined }
  | { from: 'memory'; key: string; path?: string | undefined }
  | { from: 'input'; inputKey: string; index?: number | undefined; path?: string | undefined }
  | { from: 'asset'; assetId: string }
  /** The channel's uploaded assets (and the ones built into Reelcraft), as a catalogue
   * with the name, tags and length of each. A planning stage reads it to pick from; Compose
   * Timeline places them. Assets with every tag in `tags` only; `builtin: false` leaves out the
   * built-in ones. */
  | {
      from: 'library';
      /** Which kinds to list; left out, all of them. */
      kinds?: LibraryKind[] | undefined;
      tags?: string[] | undefined;
      builtin?: boolean | undefined;
    }
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
  z.object({
    from: z.literal('stage'),
    stageKey: z.string(),
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
  z.object({
    from: z.literal('library'),
    kinds: z.array(z.enum(LIBRARY_KINDS)).min(1).max(4).optional(),
    tags: z.array(z.string().min(1).max(60)).max(10).optional(),
    builtin: z.boolean().optional(),
  }),
  z.object({ from: z.literal('role'), roleKey: z.string() }),
  z.object({ from: z.literal('item'), path: z.string().optional() }),
  z.object({ from: z.literal('prevItem'), path: z.string().optional() }),
  z.object({ from: z.literal('const'), value: z.unknown() }),
  z.object({
    from: z.literal('coalesce'),
    refs: z.array(z.lazy(() => Ref)).min(2),
  }),
]);
