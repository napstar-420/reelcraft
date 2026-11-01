import { z } from 'zod';
import { ConfigLayer, type CreateBlueprintVersionDto } from '@reelcraft/shared';
import { currentDraft } from './current-draft';
import { confirmChange, turnEnded } from './gate';
import { freeObject, obj, str } from './json-schemas';
import type { AssistantTool, ToolDeps } from './types';

const CHANNEL_ID = str('A channel id (from list_channels or the context).', { minLength: 1 });
const BLUEPRINT_ID = str('A blueprint id (from list_blueprints or the context).', { minLength: 1 });

const versionLabel = (v: { major: number; minor: number }) => `${v.major}.${v.minor}`;

// ---- channels ----------------------------------------------------------------------------

const CreateChannelInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional(),
});

const createChannel: AssistantTool<z.infer<typeof CreateChannelInput>> = {
  name: 'create_channel',
  kind: 'change',
  description:
    'Create a channel: a home for blueprints that share a theme, a library of assets and Characters, and default settings. Returns its id.',
  input: CreateChannelInput,
  jsonSchema: () =>
    obj(
      {
        name: str('Channel name', { minLength: 1, maxLength: 120 }),
        description: str('One line about what the channel makes', { maxLength: 255 }),
      },
      ['name'],
    ),
  async handler(ctx, deps, input) {
    const refused = await confirmChange(ctx, {
      tool: 'create_channel',
      kind: 'change',
      title: `Create the channel "${input.name}"`,
      details: input.description ? [input.description] : [],
    });
    if (refused) return refused;
    const channel = await deps.channels.create('local', {
      name: input.name,
      ...(input.description && { description: input.description }),
      theme: {},
      defaults: {},
    });
    return { ok: true, result: { status: 'created', channelId: channel.id, name: channel.name } };
  },
};

const UpdateChannelInput = z
  .object({
    channelId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(255).optional(),
    defaults: ConfigLayer.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.defaults !== undefined, {
    message: 'Give at least one of name, description, defaults.',
  });

const updateChannel: AssistantTool<z.infer<typeof UpdateChannelInput>> = {
  name: 'update_channel',
  kind: 'change',
  description:
    "Change a channel's name, description or default settings (the channel layer of get_effective_config: models, voices, retries… every blueprint in the channel inherits them). defaults REPLACES the whole layer: read it with get_channel first and send it back with your change.",
  input: UpdateChannelInput,
  jsonSchema: () =>
    obj(
      {
        channelId: CHANNEL_ID,
        name: str('New name', { minLength: 1, maxLength: 120 }),
        description: str('New description', { maxLength: 255 }),
        defaults: freeObject('The whole channel defaults layer (a config layer).'),
      },
      ['channelId'],
    ),
  async handler(ctx, deps, input) {
    const current = await deps.channels.get(input.channelId);
    const { channelId, ...changes } = input;
    const details = [
      ...(changes.name ? [`Name: ${current.name} → ${changes.name}`] : []),
      ...(changes.description !== undefined ? [`Description: ${changes.description}`] : []),
      ...(changes.defaults ? ['New default settings for every blueprint in it'] : []),
    ];
    const refused = await confirmChange(ctx, {
      tool: 'update_channel',
      kind: 'change',
      title: `Change the channel "${current.name}"`,
      details,
    });
    if (refused) return refused;
    await deps.channels.update(channelId, changes);
    return { ok: true, result: { status: 'changed', channelId } };
  },
};

const ArchiveChannelInput = z.object({ channelId: z.string().min(1), archived: z.boolean() });

const archiveChannel: AssistantTool<z.infer<typeof ArchiveChannelInput>> = {
  name: 'archive_channel',
  kind: 'change',
  description:
    'Archive a channel (hidden from lists, nothing deleted) or bring it back with archived=false.',
  input: ArchiveChannelInput,
  jsonSchema: () =>
    obj({ channelId: CHANNEL_ID, archived: { type: 'boolean' } }, ['channelId', 'archived']),
  async handler(ctx, deps, input) {
    const current = await deps.channels.get(input.channelId);
    const refused = await confirmChange(ctx, {
      tool: 'archive_channel',
      kind: 'change',
      title: `${input.archived ? 'Archive' : 'Unarchive'} the channel "${current.name}"`,
    });
    if (refused) return refused;
    await deps.channels.setArchived(input.channelId, input.archived);
    return { ok: true, result: { status: input.archived ? 'archived' : 'unarchived' } };
  },
};

const DeleteChannelInput = z.object({ channelId: z.string().min(1) });

const deleteChannel: AssistantTool<z.infer<typeof DeleteChannelInput>> = {
  name: 'delete_channel',
  kind: 'destroy',
  description:
    'Delete a channel for good, with ALL its blueprints, runs, videos, assets and Characters. It cannot be undone; prefer archive_channel unless the user clearly wants it gone. Refused while one of its runs is still going.',
  input: DeleteChannelInput,
  jsonSchema: () => obj({ channelId: CHANNEL_ID }, ['channelId']),
  async handler(ctx, deps, input) {
    const current = await deps.channels.get(input.channelId);
    const c = current.counts;
    const refused = await confirmChange(ctx, {
      tool: 'delete_channel',
      kind: 'destroy',
      title: `Delete the channel "${current.name}" for good`,
      details: [
        `${c.blueprints} blueprints, ${c.runs} runs, ${c.assets} assets and ${c.characters} Characters go with it`,
        'This cannot be undone',
      ],
    });
    if (refused) return refused;
    await deps.channels.delete(input.channelId);
    return { ok: true, result: { status: 'deleted' } };
  },
};

// ---- blueprints --------------------------------------------------------------------------

const CreateBlueprintInput = z.object({
  channelId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
});

const createBlueprint: AssistantTool<z.infer<typeof CreateBlueprintInput>> = {
  name: 'create_blueprint',
  kind: 'change',
  description:
    'Create an empty blueprint in a channel (names are unique per channel). Returns its id; then build its stages with propose_draft.',
  input: CreateBlueprintInput,
  jsonSchema: () =>
    obj(
      {
        channelId: CHANNEL_ID,
        name: str('Blueprint name', { minLength: 1, maxLength: 120 }),
        description: str('What video it makes', { maxLength: 500 }),
        tags: {
          type: 'array',
          maxItems: 20,
          items: str(undefined, { minLength: 1, maxLength: 32 }),
        },
      },
      ['channelId', 'name'],
    ),
  async handler(ctx, deps, input) {
    const channel = await deps.channels.get(input.channelId);
    await deps.blueprints.assertNameFree(input.channelId, input.name);
    const refused = await confirmChange(ctx, {
      tool: 'create_blueprint',
      kind: 'change',
      title: `Create the blueprint "${input.name}" in "${channel.name}"`,
      details: input.description ? [input.description] : [],
    });
    if (refused) return refused;
    const blueprintId = await deps.blueprints.createBlueprint(input.channelId, input.name, {
      description: input.description,
      tags: input.tags,
    });
    return {
      ok: true,
      result: {
        status: 'created',
        blueprintId,
        note: 'It has no stages yet: build them with propose_draft.',
      },
    };
  },
};

const ArchiveBlueprintInput = z.object({ blueprintId: z.string().min(1), archived: z.boolean() });

const archiveBlueprint: AssistantTool<z.infer<typeof ArchiveBlueprintInput>> = {
  name: 'archive_blueprint',
  kind: 'change',
  description:
    'Archive a blueprint (hidden from lists, its runs and versions kept) or bring it back with archived=false.',
  input: ArchiveBlueprintInput,
  jsonSchema: () =>
    obj({ blueprintId: BLUEPRINT_ID, archived: { type: 'boolean' } }, ['blueprintId', 'archived']),
  async handler(ctx, deps, input) {
    const current = await deps.blueprints.getBlueprint(input.blueprintId);
    const refused = await confirmChange(ctx, {
      tool: 'archive_blueprint',
      kind: 'change',
      title: `${input.archived ? 'Archive' : 'Unarchive'} the blueprint "${current.name}"`,
    });
    if (refused) return refused;
    await deps.blueprints.update(input.blueprintId, { archived: input.archived });
    deps.blueprintChanged(input.blueprintId);
    return { ok: true, result: { status: input.archived ? 'archived' : 'unarchived' } };
  },
};

const DeleteBlueprintInput = z.object({ blueprintId: z.string().min(1) });

const deleteBlueprint: AssistantTool<z.infer<typeof DeleteBlueprintInput>> = {
  name: 'delete_blueprint',
  kind: 'destroy',
  description:
    'Delete a blueprint for good, with all its versions, runs and videos. It cannot be undone; prefer archive_blueprint unless the user clearly wants it gone. Refused while one of its runs is still going.',
  input: DeleteBlueprintInput,
  jsonSchema: () => obj({ blueprintId: BLUEPRINT_ID }, ['blueprintId']),
  async handler(ctx, deps, input) {
    const current = await deps.blueprints.getBlueprint(input.blueprintId);
    const refused = await confirmChange(ctx, {
      tool: 'delete_blueprint',
      kind: 'destroy',
      title: `Delete the blueprint "${current.name}" for good`,
      details: [`Its versions and ${current.runCount} runs go with it`, 'This cannot be undone'],
    });
    if (refused) return refused;
    await deps.blueprints.delete(input.blueprintId);
    return { ok: true, result: { status: 'deleted' } };
  },
};

// ---- versions ----------------------------------------------------------------------------

const SaveVersionInput = z.object({
  blueprintId: z.string().min(1),
  bump: z.enum(['minor', 'major']).optional(),
  reason: z.string().trim().min(1).max(300),
});

const saveVersion: AssistantTool<z.infer<typeof SaveVersionInput>> = {
  name: 'save_version',
  kind: 'change',
  description:
    'Save a blueprint\'s current draft (what the editor shows, with your changes) as a new version: 1.2 → 1.3, or 2.0 with bump=major. Production runs and run_stages with version="saved" use the latest saved version, so save after fixing a blueprint before running it for real. A draft that can\'t run is saved but marked not runnable: fix it first. reason: one line on what changed.',
  input: SaveVersionInput,
  jsonSchema: () =>
    obj(
      {
        blueprintId: BLUEPRINT_ID,
        bump: str('minor (default) or major', { enum: ['minor', 'major'] }),
        reason: str('What changed, in one line', { minLength: 1, maxLength: 300 }),
      },
      ['blueprintId', 'reason'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const blueprint = await deps.blueprints.getBlueprint(input.blueprintId);
    const { draft } = await currentDraft(ctx, deps, input.blueprintId);
    const [latest] = await deps.blueprints.listVersions(input.blueprintId);
    const next = !latest
      ? '1.0'
      : input.bump === 'major'
        ? `${latest.major + 1}.0`
        : `${latest.major}.${latest.minor + 1}`;
    const refused = await confirmChange(ctx, {
      tool: 'save_version',
      kind: 'change',
      title: `Save "${blueprint.name}" as version ${next}`,
      details: [input.reason],
    });
    if (refused) return refused;
    const saved = await deps.blueprints.createVersion(input.blueprintId, draft, {
      bump: input.bump ?? 'minor',
      expectedCurrent: blueprint.currentVersionId,
    });
    if (ctx.editorDraft?.blueprintId === input.blueprintId) ctx.editorDraft = null;
    deps.blueprintChanged(input.blueprintId);
    return {
      ok: true,
      result: {
        status: 'saved',
        version: versionLabel(saved),
        blueprintVersionId: saved.id,
        runnable: saved.runnable,
      },
    };
  },
};

const RestoreVersionInput = z.object({
  blueprintId: z.string().min(1),
  version: z.string().min(1).max(20),
});

const restoreVersion: AssistantTool<z.infer<typeof RestoreVersionInput>> = {
  name: 'restore_version',
  kind: 'change',
  description:
    "Put an older saved version back as the blueprint's draft, whole (the user can Undo; save_version keeps it). To bring back only some stages, use get_version and edit_draft instead.",
  input: RestoreVersionInput,
  jsonSchema: () =>
    obj(
      {
        blueprintId: BLUEPRINT_ID,
        version: str('A saved version label such as "1.2"', { minLength: 1, maxLength: 20 }),
      },
      ['blueprintId', 'version'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const blueprint = await deps.blueprints.getBlueprint(input.blueprintId);
    const versions = await deps.blueprints.listVersions(input.blueprintId);
    const found = versions.find((v) => versionLabel(v) === input.version);
    if (!found) {
      return {
        ok: false,
        error: `This blueprint has no version "${input.version}". Saved versions: ${
          versions.map(versionLabel).join(', ') || '(none yet)'
        }.`,
      };
    }
    const { draft: before } = await currentDraft(ctx, deps, input.blueprintId);
    const after = toDraft(found);
    const change = {
      kind: 'draft' as const,
      blueprintId: input.blueprintId,
      blueprintName: blueprint.name,
      summary: `Brought back version ${input.version}`,
      before,
      after,
      warnings: [],
    };
    const refused = await confirmChange(ctx, {
      tool: 'restore_version',
      kind: 'change',
      title: `Bring back version ${input.version} of "${blueprint.name}" as its draft`,
      change,
    });
    if (refused) return refused;
    await deps.blueprints.setWorkingDraft(input.blueprintId, after, blueprint.currentVersionId);
    if (ctx.editorDraft?.blueprintId === input.blueprintId) ctx.editorDraft = null;
    deps.blueprintChanged(input.blueprintId);
    return {
      ok: true,
      result: { status: 'restored', note: 'It is the unsaved draft now: save_version keeps it.' },
      item: { type: 'change', payload: change },
    };
  },
};

function toDraft(v: Awaited<ReturnType<ToolDeps['blueprints']['listVersions']>>[number]) {
  // jsonb columns come back untyped; they were validated when the version was saved
  return {
    graph: v.graph,
    inputs: v.inputs,
    roles: v.roles,
    defaults: v.defaults,
    budget: v.budget,
    presentation: v.presentation ?? undefined,
    execution: v.execution,
  } as CreateBlueprintVersionDto;
}

export const MANAGE_TOOLS: AssistantTool<never>[] = [
  createChannel,
  updateChannel,
  archiveChannel,
  deleteChannel,
  createBlueprint,
  archiveBlueprint,
  deleteBlueprint,
  saveVersion,
  restoreVersion,
] as unknown as AssistantTool<never>[];
