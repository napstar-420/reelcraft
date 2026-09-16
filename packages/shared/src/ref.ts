import { z } from 'zod';

/**
 * A stage binds only the previous stage (§6.1). Anything further back
 * travels through Run Memory. There is no `{from: 'stage', stageKey}` variant
 * — this is the v6 decision, not an omission.
 */
export const Ref = z.discriminatedUnion('from', [
  z.object({ from: z.literal('prev'), path: z.string().optional(), alignWith: z.literal('item').optional() }),
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
]);
export type Ref = z.infer<typeof Ref>;
