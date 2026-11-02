import { z } from 'zod';
import { MAX_ASSISTANT_NOTE_CHARS } from '@reelcraft/shared';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import { UNTRUSTED_TAIL, withNotice } from './run-tools';
import type { AssistantTool, ToolOutcome } from './types';

// ---- remember / forget -------------------------------------------------------------------

const RememberInput = z
  .object({
    scope: z.enum(['global', 'channel']),
    channelId: z.string().min(1).optional(),
    text: z.string().trim().min(1).max(MAX_ASSISTANT_NOTE_CHARS),
  })
  .refine((v) => (v.scope === 'channel') === Boolean(v.channelId), {
    message: 'A channel note needs channelId; a global note has none.',
  });

const remember: AssistantTool<z.infer<typeof RememberInput>> = {
  name: 'remember',
  kind: 'change',
  description: `Save a note you will be given in every later chat: a lasting preference ("always 9:16", "keep runs under $2"), a correction ("my channel's host is Mia, not Maya"), or something that failed and why. scope "channel" (with channelId) applies when a chat is about that channel; "global" everywhere. One fact per note, at most ${MAX_ASSISTANT_NOTE_CHARS} characters, in plain words. Never secrets, keys or passwords, and nothing about one run only.`,
  input: RememberInput,
  jsonSchema: () =>
    obj(
      {
        scope: { type: 'string', enum: ['global', 'channel'] },
        channelId: str('For a channel note: the channel.'),
        text: str('The note', { minLength: 1, maxLength: MAX_ASSISTANT_NOTE_CHARS }),
      },
      ['scope', 'text'],
    ),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const channel = input.channelId ? await deps.channels.get(input.channelId) : null;
    const refused = await confirmChange(ctx, {
      tool: 'remember',
      kind: 'change',
      title: channel ? `Remember this for "${channel.name}"` : 'Remember this everywhere',
      details: [input.text],
    });
    if (refused) return refused;
    const note = await deps.knowledge.createNote({
      scope: input.scope,
      channelId: channel?.id ?? null,
      text: input.text,
      source: 'assistant',
    });
    return {
      ok: true,
      result: { status: 'remembered', noteId: note.id },
      item: {
        type: 'change',
        payload: {
          kind: 'note',
          action: 'added',
          note: {
            id: note.id,
            scope: note.scope,
            channelId: note.channelId,
            channelName: channel?.name ?? null,
            text: note.text,
          },
        },
      },
    };
  },
};

const ForgetInput = z.object({ noteId: z.string().min(1) });

const forget: AssistantTool<z.infer<typeof ForgetInput>> = {
  name: 'forget',
  kind: 'change',
  description:
    'Remove a note (its noteId is in the <notes> of the message, or from list_notes) when the user says it no longer applies, or before saving one that replaces it.',
  input: ForgetInput,
  jsonSchema: () => obj({ noteId: str('The note to remove', { minLength: 1 }) }, ['noteId']),
  async handler(ctx, deps, input): Promise<ToolOutcome> {
    const note = await deps.knowledge.getNote(input.noteId);
    const channel = note.channelId
      ? await deps.channels.get(note.channelId).catch(() => null)
      : null;
    const refused = await confirmChange(ctx, {
      tool: 'forget',
      kind: 'change',
      title: 'Forget a note',
      details: [note.text],
    });
    if (refused) return refused;
    await deps.knowledge.deleteNote(note.id);
    return {
      ok: true,
      result: { status: 'forgotten', noteId: note.id },
      item: {
        type: 'change',
        payload: {
          kind: 'note',
          action: 'removed',
          note: {
            id: note.id,
            scope: note.scope,
            channelId: note.channelId,
            channelName: channel?.name ?? null,
            text: note.text,
          },
        },
      },
    };
  },
};

// ---- list_notes / recall ------------------------------------------------------------------

const ListNotesInput = z.object({ channelId: z.string().min(1).optional() });

const listNotes: AssistantTool<z.infer<typeof ListNotesInput>> = {
  name: 'list_notes',
  kind: 'read',
  description:
    "List the saved notes: the global ones, and one channel's (channelId), with their ids. Messages already carry the notes that apply; use this to see another channel's notes.",
  input: ListNotesInput,
  jsonSchema: () => obj({ channelId: str('Also this channel’s notes.') }),
  async handler(_ctx, deps, input) {
    const global = await deps.knowledge.listNotes({ scope: 'global' });
    const channel = input.channelId
      ? await deps.knowledge.listNotes({ scope: 'channel', channelId: input.channelId })
      : [];
    const shape = (n: (typeof global)[number]) => ({
      noteId: n.id,
      text: n.text,
      source: n.source,
    });
    return {
      ok: true,
      result: {
        global: global.map(shape),
        ...(input.channelId && { channel: channel.map(shape) }),
      },
    };
  },
};

const RecallInput = z.object({
  query: z.string().trim().min(1).max(300),
  channelId: z.string().min(1).optional(),
  kind: z.enum(['chat', 'breakdown', 'goal_report']).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});

const recall: AssistantTool<z.infer<typeof RecallInput>> = {
  name: 'recall',
  kind: 'read',
  description: `Search past work: earlier chats (what was asked and answered), video breakdowns you saved, and goal reports. Use it when the user refers to something from before ("like the space reel last week", "what fixed the voice last time") or before rebuilding a style you may have done already. Words match whole words and their forms; quote a phrase for an exact match. Returns the best matches with a snippet (matches between « »), when, and the chat, channel or blueprint they belong to.${UNTRUSTED_TAIL}`,
  input: RecallInput,
  jsonSchema: () =>
    obj(
      {
        query: str('What to look for', { minLength: 1, maxLength: 300 }),
        channelId: str('Only memories about this channel.'),
        kind: { type: 'string', enum: ['chat', 'breakdown', 'goal_report'] },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'How many (default 5).' },
      },
      ['query'],
    ),
  async handler(_ctx, deps, input) {
    const hits = await deps.knowledge.search(input.query, {
      ...(input.channelId && { channelId: input.channelId }),
      ...(input.kind && { kind: input.kind }),
      limit: input.limit ?? 5,
    });
    return {
      ok: true,
      result: withNotice({
        query: input.query,
        results: hits,
        ...(hits.length === 0 && { note: 'Nothing matched. Try fewer or other words.' }),
      }),
    };
  },
};

export const MEMORY_TOOLS: AssistantTool<never>[] = [
  remember,
  forget,
  listNotes,
  recall,
] as unknown as AssistantTool<never>[];
