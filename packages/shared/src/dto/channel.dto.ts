import { z } from 'zod';
import { ConfigLayer } from '../config-layer';

export const CreateChannelDto = z.object({
  name: z.string().min(1),
  description: z.string().max(255).optional(),
  theme: z.record(z.string(), z.unknown()).default({}),
  defaults: ConfigLayer.default({}),
});
export type CreateChannelDto = z.infer<typeof CreateChannelDto>;

export const UpdateChannelDto = z.object({
  name: z.string().min(1).optional(),
  description: z.string().max(255).optional(),
  theme: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateChannelDto = z.infer<typeof UpdateChannelDto>;

export const ArchiveChannelDto = z.object({
  archived: z.boolean(),
});
export type ArchiveChannelDto = z.infer<typeof ArchiveChannelDto>;

/** `includeArchived` mirrors `ListRunsQueryDto.includeDryRuns` (run.dto.ts) —
 * `z.coerce` because query params arrive as strings over HTTP. */
export const ListChannelsQueryDto = z.object({
  includeArchived: z.coerce.boolean().optional().default(false),
});
export type ListChannelsQueryDto = z.infer<typeof ListChannelsQueryDto>;

export const ChannelCountsDto = z.object({
  blueprints: z.number(),
  characters: z.number(),
  assets: z.number(),
  runs: z.number(),
});
export type ChannelCountsDto = z.infer<typeof ChannelCountsDto>;

export const ChannelDto = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  theme: z.record(z.string(), z.unknown()),
  defaults: ConfigLayer,
  archived: z.boolean(),
  createdAt: z.string(),
  counts: ChannelCountsDto,
});
export type ChannelDto = z.infer<typeof ChannelDto>;
