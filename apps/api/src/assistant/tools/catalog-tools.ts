import { z } from 'zod';
import { obj, str } from './json-schemas';
import type { AssistantTool } from './types';

// ---- list_channels ----

const ListChannelsInput = z.object({ includeArchived: z.boolean().optional() });

const listChannels: AssistantTool<z.infer<typeof ListChannelsInput>> = {
  name: 'list_channels',
  kind: 'read',
  description:
    'List the channels: id, name, description, whether archived, and how many blueprints, runs, assets and Characters each has. A channel holds blueprints, their runs, and a library of assets and Characters. Use get_channel for one channel in detail.',
  input: ListChannelsInput,
  jsonSchema: () =>
    obj({
      includeArchived: { type: 'boolean', description: 'Include archived channels.' },
    }),
  async handler(_ctx, deps, input) {
    const channels = await deps.channels.list({ includeArchived: input.includeArchived ?? false });
    return {
      ok: true,
      result: {
        channels: channels.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          archived: c.archived,
          counts: c.counts,
        })),
      },
    };
  },
};

// ---- list_blueprints ----

const ListBlueprintsInput = z.object({
  channelId: z.string().min(1).optional(),
  query: z.string().trim().max(120).optional(),
  includeArchived: z.boolean().optional(),
});

const listBlueprints: AssistantTool<z.infer<typeof ListBlueprintsInput>> = {
  name: 'list_blueprints',
  kind: 'read',
  description:
    'List blueprints across every channel (or one channel): id, channel, name, description, tags, run count, whether archived, and whether it has unsaved changes. query matches words in the name, description and tags. Use it to find the blueprint a user means, then get_blueprint.',
  input: ListBlueprintsInput,
  jsonSchema: () =>
    obj({
      channelId: str('Only this channel.'),
      query: str('Words to match in the name, description or tags.', { maxLength: 120 }),
      includeArchived: { type: 'boolean', description: 'Include archived blueprints.' },
    }),
  async handler(_ctx, deps, input) {
    const channels = input.channelId
      ? [await deps.channels.get(input.channelId)]
      : await deps.channels.list({ includeArchived: true });
    const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (
      await Promise.all(
        channels.map(async (channel) =>
          (await deps.blueprints.listByChannel(channel.id)).map((b) => ({
            id: b.id,
            channelId: channel.id,
            channelName: channel.name,
            name: b.name,
            description: b.description,
            tags: b.tags,
            runCount: b.runCount,
            archived: b.archived,
            hasUnsavedChanges: b.workingDraft !== null,
          })),
        ),
      )
    )
      .flat()
      .filter((b) => input.includeArchived || !b.archived)
      .filter((b) => {
        const text = `${b.name} ${b.description ?? ''} ${b.tags.join(' ')}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
    return { ok: true, result: { total: rows.length, blueprints: rows.slice(0, 100) } };
  },
};

export const CATALOG_TOOLS: AssistantTool<never>[] = [
  listChannels,
  listBlueprints,
] as unknown as AssistantTool<never>[];
