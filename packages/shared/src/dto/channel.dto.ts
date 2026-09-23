import { z } from 'zod';
import { ConfigLayer } from '../config-layer';

export const CreateChannelDto = z.object({
  name: z.string().min(1),
  description: z.string().max(255).optional(),
  theme: z.record(z.string(), z.unknown()).default({}),
  defaults: ConfigLayer.default({}),
});
export type CreateChannelDto = z.infer<typeof CreateChannelDto>;

export const ChannelDto = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  theme: z.record(z.string(), z.unknown()),
  defaults: ConfigLayer,
  createdAt: z.string(),
});
export type ChannelDto = z.infer<typeof ChannelDto>;
