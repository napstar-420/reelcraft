import { z } from 'zod';
import { AssetKind, ReferenceImage } from '@reelcraft/shared';
import { objectKey } from '../../storage/object-key';
import { assetKindFor } from '../../channel/asset-kind';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import { MediaSource, mediaSourceJson, resolveMedia } from './media-source';
import type { AssistantTool, ToolDeps, ToolOutcome } from './types';

const CHANNEL_ID = str('A channel id (from list_channels or the context).', { minLength: 1 });
const VIEW = ReferenceImage.shape.view;
const VIEWS = VIEW.options;

const fail = (error: string): ToolOutcome => ({ ok: false, error });

/** The stored file behind a source, of any kind (fonts and drawings included). */
async function fileOf(deps: ToolDeps, source: MediaSource) {
  return resolveMedia(deps, source, ['image', 'video', 'audio', 'other']);
}

// ---- save_to_library ---------------------------------------------------------------------

const SaveInput = z.object({
  channelId: z.string().min(1),
  source: MediaSource,
  name: z.string().trim().min(1).max(120),
  kind: AssetKind.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

/** Copies a file into a channel's Library and returns the new asset. Shared with make_voice. */
async function saveToLibrary(
  deps: ToolDeps,
  input: z.infer<typeof SaveInput>,
  file: { blobId: string; mime: string },
): Promise<ToolOutcome & { assetId?: string }> {
  const channel = await deps.channels.get(input.channelId);
  const copy = await deps.files.copy(file.blobId, (blobId, ext) =>
    objectKey.asset(channel.ownerId, channel.id, blobId, ext),
  );
  const kind = input.kind ?? assetKindFor(copy.mime, copy.ext);
  if (!kind) {
    return fail(
      `A ${copy.mime || copy.ext} file isn't a Library kind: pass kind (${AssetKind.options.join(', ')}).`,
    );
  }
  const created = await deps.assets.create(channel.id, {
    name: input.name,
    kind,
    blobId: copy.blobId,
    objectKey: copy.objectKey,
    sha256: copy.sha256,
    tags: input.tags ?? [],
  });
  return {
    ok: true,
    assetId: created.id,
    result: {
      status: 'saved',
      assetId: created.id,
      channelId: channel.id,
      name: created.name,
      kind: created.kind,
      note: 'A stage can use it now: bind it with {from:"asset", assetId} or pick it in the Library.',
    },
  };
}

const saveToLibraryTool: AssistantTool<z.infer<typeof SaveInput>> = {
  name: 'save_to_library',
  kind: 'change',
  description: `Save a file into a channel's Library as an asset, so blueprints can use it: a file the user attached ({attachmentId}), something a run made ({runId, stageKey, itemIndex?}) or a Character reference. name must be unique in the channel. kind is worked out from the file (picture, video, sound, drawing, font, 3D model); pass it only to override. Ask which channel when it isn't clear.`,
  input: SaveInput,
  jsonSchema: () =>
    obj(
      {
        channelId: CHANNEL_ID,
        source: mediaSourceJson('The file to save.'),
        name: str('Asset name, unique in the channel', { minLength: 1, maxLength: 120 }),
        kind: { type: 'string', enum: [...AssetKind.options], description: 'Override the kind.' },
        tags: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Tags.' },
      },
      ['channelId', 'source', 'name'],
    ),
  async handler(ctx, deps, input) {
    const resolved = await fileOf(deps, input.source);
    if (!resolved.ok) return resolved;
    const channel = await deps.channels.get(input.channelId);
    const refused = await confirmChange(ctx, {
      tool: 'save_to_library',
      kind: 'change',
      title: `Save ${resolved.file.label} to the Library of "${channel.name}" as "${input.name}"`,
      details: input.tags?.length ? [`Tags: ${input.tags.join(', ')}`] : [],
    });
    if (refused) return refused;
    const saved = await saveToLibrary(deps, input, resolved.file);
    delete saved.assetId;
    return saved;
  },
};

// ---- delete_asset ------------------------------------------------------------------------

const DeleteAssetInput = z.object({ assetId: z.string().min(1) });

const deleteAsset: AssistantTool<z.infer<typeof DeleteAssetInput>> = {
  name: 'delete_asset',
  kind: 'destroy',
  description:
    "Delete an asset from a channel's Library. Blueprints that use it fail validation until another asset is chosen; past runs keep their copy. Only when the user asks.",
  input: DeleteAssetInput,
  jsonSchema: () =>
    obj({ assetId: str('An asset id from get_channel.', { minLength: 1 }) }, ['assetId']),
  async handler(ctx, deps, input) {
    const asset = await deps.assets.get(input.assetId);
    const refused = await confirmChange(ctx, {
      tool: 'delete_asset',
      kind: 'destroy',
      title: `Delete the asset "${asset.name}"`,
      details: ['Blueprints that use it need another asset; past runs keep their copy'],
    });
    if (refused) return refused;
    await deps.assets.delete(asset.id);
    return { ok: true, result: { status: 'deleted', assetId: asset.id, name: asset.name } };
  },
};

// ---- Characters --------------------------------------------------------------------------

const ReferenceInput = z.object({
  source: MediaSource,
  view: VIEW,
  caption: z.string().trim().max(200).optional(),
});

const referenceJson = () =>
  obj(
    {
      source: mediaSourceJson('A picture of the Character.'),
      view: { type: 'string', enum: [...VIEWS], description: 'What the picture shows.' },
      caption: str('What is in the picture, e.g. "smiling, red scarf"', { maxLength: 200 }),
    },
    ['source', 'view'],
  );

/** Copies each picture into the Character's references (checked like an upload). */
async function addReferences(
  deps: ToolDeps,
  characterId: string,
  refs: Array<z.infer<typeof ReferenceInput> & { blobId: string }>,
): Promise<string[]> {
  const character = await deps.characters.get(characterId);
  const added: string[] = [];
  for (const ref of refs) {
    const copy = await deps.files.copy(ref.blobId, (blobId) =>
      objectKey.characterRef(character.ownerId, character.id, blobId),
    );
    await deps.characters.confirmReference(character.id, {
      blobId: copy.blobId,
      objectKey: copy.objectKey,
      sha256: copy.sha256,
      view: ref.view,
      ...(ref.caption && { caption: ref.caption }),
    });
    added.push(copy.blobId);
  }
  return added;
}

/** Each reference's picture, checked before anything is written. */
async function resolveReferences(
  deps: ToolDeps,
  refs: Array<z.infer<typeof ReferenceInput>>,
): Promise<
  | { ok: true; refs: Array<z.infer<typeof ReferenceInput> & { blobId: string; label: string }> }
  | { ok: false; error: string }
> {
  const out: Array<z.infer<typeof ReferenceInput> & { blobId: string; label: string }> = [];
  for (const ref of refs) {
    const resolved = await resolveMedia(deps, ref.source, ['image']);
    if (!resolved.ok) return resolved;
    out.push({ ...ref, blobId: resolved.file.blobId, label: resolved.file.label });
  }
  return { ok: true, refs: out };
}

const CreateCharacterInput = z.object({
  channelId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
  references: z.array(ReferenceInput).max(12).optional(),
});

const createCharacter: AssistantTool<z.infer<typeof CreateCharacterInput>> = {
  name: 'create_character',
  kind: 'change',
  description: `Create a Character in a channel: a person, mascot or object that must look the same in every picture. description says what never changes (face, hair, build, clothing). references are pictures of it (a file the user attached, or an image a run made), each with its view (${VIEWS.join(', ')}); the first is the main one. A Character with at least one picture is ready to use in a blueprint's roles.`,
  input: CreateCharacterInput,
  jsonSchema: () =>
    obj(
      {
        channelId: CHANNEL_ID,
        name: str('Character name', { minLength: 1, maxLength: 80 }),
        description: str('What always stays the same about it', { maxLength: 1000 }),
        references: {
          type: 'array',
          maxItems: 12,
          items: referenceJson(),
          description: 'Pictures of the Character.',
        },
      },
      ['channelId', 'name'],
    ),
  async handler(ctx, deps, input) {
    const refs = await resolveReferences(deps, input.references ?? []);
    if (!refs.ok) return refs;
    const channel = await deps.channels.get(input.channelId);
    const refused = await confirmChange(ctx, {
      tool: 'create_character',
      kind: 'change',
      title: `Create the Character "${input.name}" in "${channel.name}"`,
      details: [
        ...(input.description ? [input.description.slice(0, 200)] : []),
        ...refs.refs.map((r) => `Picture (${r.view}): ${r.label}`),
      ],
    });
    if (refused) return refused;
    const character = await deps.characters.create(channel.id, {
      name: input.name,
      description: input.description ?? '',
    });
    const added = await addReferences(deps, character.id, refs.refs);
    return {
      ok: true,
      result: {
        status: 'created',
        characterId: character.id,
        name: character.name,
        references: added,
        ready: added.length > 0,
      },
    };
  },
};

const UpdateCharacterInput = z
  .object({
    characterId: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(1000).optional(),
    addReferences: z.array(ReferenceInput).max(12).optional(),
    removeReferences: z.array(z.string().min(1)).max(12).optional(),
    primary: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      Boolean(v.addReferences?.length) ||
      Boolean(v.removeReferences?.length) ||
      v.primary !== undefined,
    { message: 'Give something to change.' },
  );

const updateCharacter: AssistantTool<z.infer<typeof UpdateCharacterInput>> = {
  name: 'update_character',
  kind: 'change',
  description:
    "Change a Character: its name or description, add pictures (addReferences, like create_character), remove pictures (removeReferences: their blobIds from get_channel), or choose the main picture (primary: a blobId; it may be one you add now: pass 'new:0' for the first added). Blueprints using it see the change in their next run.",
  input: UpdateCharacterInput,
  jsonSchema: () =>
    obj(
      {
        characterId: str('A Character id from get_channel.', { minLength: 1 }),
        name: str('New name', { minLength: 1, maxLength: 80 }),
        description: str('New description', { maxLength: 1000 }),
        addReferences: { type: 'array', maxItems: 12, items: referenceJson() },
        removeReferences: {
          type: 'array',
          maxItems: 12,
          items: { type: 'string' },
          description: 'blobIds of pictures to remove.',
        },
        primary: str("The main picture's blobId, or 'new:N' for the Nth added."),
      },
      ['characterId'],
    ),
  async handler(ctx, deps, input) {
    const character = await deps.characters.get(input.characterId);
    const current = (character.referenceSet as Array<{ blobId: string }>).map((r) => r.blobId);
    const unknown = (input.removeReferences ?? []).filter((id) => !current.includes(id));
    if (unknown.length) return fail(`${character.name} has no pictures ${unknown.join(', ')}.`);
    const refs = await resolveReferences(deps, input.addReferences ?? []);
    if (!refs.ok) return refs;
    const newIndex = input.primary?.startsWith('new:') ? Number(input.primary.slice(4)) : null;
    if (newIndex !== null && !(newIndex >= 0 && newIndex < refs.refs.length)) {
      return fail(`primary "${input.primary}" points past the pictures you add.`);
    }
    if (input.primary && newIndex === null && !current.includes(input.primary)) {
      return fail(`${character.name} has no picture ${input.primary}.`);
    }
    const refused = await confirmChange(ctx, {
      tool: 'update_character',
      kind: 'change',
      title: `Change the Character "${character.name}"`,
      details: [
        ...(input.name ? [`Rename to "${input.name}"`] : []),
        ...(input.description !== undefined ? ['New description'] : []),
        ...refs.refs.map((r) => `Add a picture (${r.view}): ${r.label}`),
        ...(input.removeReferences?.length
          ? [`Remove ${input.removeReferences.length} picture(s)`]
          : []),
        ...(input.primary ? ['Choose the main picture'] : []),
      ],
    });
    if (refused) return refused;
    if (input.name !== undefined || input.description !== undefined) {
      await deps.characters.update(character.id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
      });
    }
    const added = await addReferences(deps, character.id, refs.refs);
    for (const blobId of input.removeReferences ?? []) {
      await deps.characters.deleteReference(character.id, blobId);
    }
    const primary = newIndex !== null ? added[newIndex] : input.primary;
    if (primary) await deps.characters.setPrimary(character.id, primary);
    const after = await deps.characters.get(character.id);
    return {
      ok: true,
      result: {
        status: 'updated',
        characterId: after.id,
        name: after.name,
        references: (after.referenceSet as Array<{ blobId: string; view: string }>).map((r) => ({
          blobId: r.blobId,
          view: r.view,
        })),
        primary: after.primaryRefId,
        added,
      },
    };
  },
};

const DeleteCharacterInput = z.object({ characterId: z.string().min(1) });

const deleteCharacter: AssistantTool<z.infer<typeof DeleteCharacterInput>> = {
  name: 'delete_character',
  kind: 'destroy',
  description:
    'Delete a Character and its pictures. Blueprints that use it fail validation until another Character is chosen; past runs keep their copy. Only when the user asks.',
  input: DeleteCharacterInput,
  jsonSchema: () =>
    obj({ characterId: str('A Character id from get_channel.', { minLength: 1 }) }, [
      'characterId',
    ]),
  async handler(ctx, deps, input) {
    const character = await deps.characters.get(input.characterId);
    const refused = await confirmChange(ctx, {
      tool: 'delete_character',
      kind: 'destroy',
      title: `Delete the Character "${character.name}"`,
      details: ['Blueprints that use it need another Character; past runs keep their copy'],
    });
    if (refused) return refused;
    await deps.characters.delete(character.id);
    return { ok: true, result: { status: 'deleted', characterId: character.id } };
  },
};

// ---- make_voice --------------------------------------------------------------------------

const MakeVoiceInput = z.object({
  source: MediaSource,
  name: z.string().trim().min(1).max(80),
  channelId: z.string().min(1).optional(),
  transcript: z.string().trim().max(2000).optional(),
  language: z.string().trim().max(20).optional(),
});

const makeVoice: AssistantTool<z.infer<typeof MakeVoiceInput>> = {
  name: 'make_voice',
  kind: 'action',
  description:
    "Make a VoiceStudio voice that sounds like a recording (a clear voice, ideally 10-30 seconds, no music): a Library asset ({assetId}), or a file the user attached ({attachmentId}) with channelId (it is saved to that channel's Library first). transcript is what the recording says (VoiceStudio transcribes it when omitted). Returns the voice id for a speech stage's voiceId. Needs VoiceStudio running; free. Only make a voice of someone who agreed to it.",
  input: MakeVoiceInput,
  jsonSchema: () =>
    obj(
      {
        source: mediaSourceJson('The recording.'),
        name: str('Voice name', { minLength: 1, maxLength: 80 }),
        channelId: str('For an attachment: the channel whose Library keeps the recording.'),
        transcript: str('What the recording says', { maxLength: 2000 }),
        language: str('Language code, e.g. en', { maxLength: 20 }),
      },
      ['source', 'name'],
    ),
  async handler(ctx, deps, input) {
    const resolved = await resolveMedia(deps, input.source, ['audio', 'video']);
    if (!resolved.ok) return resolved;
    if (!input.source.assetId && !input.channelId) {
      return fail('Pass channelId: the recording is saved to that Library first.');
    }
    const refused = await confirmChange(ctx, {
      tool: 'make_voice',
      kind: 'action',
      title: `Make the VoiceStudio voice "${input.name}" from ${resolved.file.label}`,
      details: input.source.assetId ? [] : ["Saves the recording to the channel's Library first"],
      costUsd: 0,
    });
    if (refused) return refused;
    let assetId = input.source.assetId;
    if (!assetId) {
      const saved = await saveToLibrary(
        deps,
        {
          channelId: input.channelId!,
          source: input.source,
          name: `${input.name} (voice sample)`,
        },
        resolved.file,
      );
      if (!saved.ok) return saved;
      assetId = saved.assetId!;
    }
    const voice = await deps.voices.cloneFromAsset({
      assetId,
      name: input.name,
      ...(input.transcript && { transcript: input.transcript }),
      ...(input.language && { language: input.language }),
    });
    return {
      ok: true,
      result: {
        status: 'created',
        voiceId: voice.id,
        name: voice.name,
        sampleAssetId: assetId,
        note: 'Use voiceId in a speech stage with the VoiceStudio provider.',
      },
    };
  },
};

export const LIBRARY_TOOLS: AssistantTool<never>[] = [
  saveToLibraryTool,
  deleteAsset,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  makeVoice,
] as unknown as AssistantTool<never>[];
