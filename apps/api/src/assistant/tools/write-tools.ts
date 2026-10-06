import { z } from 'zod';
import { BlueprintMetadataChanges } from '@reelcraft/shared';
import { ConflictException } from '@nestjs/common';
import { qualityIssues } from './quality-checks';
import { parseDraft } from './draft-checks';
import { draftJsonSchema, obj, str } from './json-schemas';
import type { AssistantTool, TurnContext, ToolOutcome } from './types';

const WAITING =
  "You asked the user a question. End your turn now: the answers arrive as the user's next message. Don't propose anything until then.";

function refuseAfterQuestion(ctx: TurnContext): ToolOutcome | null {
  return ctx.questionAsked ? { ok: false, error: WAITING } : null;
}

const ProposeInput = z.object({
  draft: z.unknown(),
  summary: z.string().min(1).max(500),
});

const proposeDraft: AssistantTool<z.infer<typeof ProposeInput>> = {
  name: 'propose_draft',
  kind: 'write',
  description:
    'Propose the COMPLETE new draft to the user. It is validated first: if it has any error you get the issues back and nothing is proposed, so fix them and call again. A valid draft is shown to the user (or applied to the canvas, in auto-apply mode). You can never save a version. summary: one or two plain sentences on what changed and why.',
  input: ProposeInput,
  jsonSchema: (n) =>
    obj(
      {
        draft: draftJsonSchema(n),
        summary: str('What changed, in plain language.', { minLength: 1, maxLength: 500 }),
      },
      ['draft', 'summary'],
    ),
  async handler(ctx, deps, input) {
    const refusal = refuseAfterQuestion(ctx);
    if (refusal) return refusal;
    const parsed = parseDraft(input.draft);
    if (!parsed.ok)
      return { ok: false, error: 'The draft has the wrong shape.', issues: parsed.issues };
    const validation = await deps.blueprints.validateOnly(ctx.blueprintId, parsed.draft);
    const issues = [...validation.issues, ...qualityIssues(parsed.draft)];
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return {
        ok: false,
        error: `The draft has ${errors.length} error(s). Fix them and propose again.`,
        issues,
      };
    }
    ctx.lastProposal = parsed.draft;
    const warnings = validation.issues.filter((i) => i.severity === 'warning');
    return {
      ok: true,
      result: { status: 'proposed', warnings },
      item: {
        type: 'proposal',
        payload: { kind: 'draft', draft: parsed.draft, summary: input.summary, warnings },
      },
    };
  },
};

const MetadataInput = BlueprintMetadataChanges.extend({
  summary: z.string().min(1).max(500),
}).refine((v) => v.name !== undefined || v.description !== undefined || v.tags !== undefined, {
  message: 'Give at least one of name, description, tags.',
});

const updateMetadata: AssistantTool<z.infer<typeof MetadataInput>> = {
  name: 'update_metadata',
  kind: 'write',
  description:
    "Propose a change to the blueprint's name, description and/or tags (not part of the draft). Names must be unique in the channel. Shown to the user like a draft proposal.",
  input: MetadataInput,
  jsonSchema: () =>
    obj(
      {
        name: str('New name', { minLength: 1, maxLength: 120 }),
        description: { type: ['string', 'null'], maxLength: 500, description: 'null clears it' },
        tags: {
          type: 'array',
          maxItems: 20,
          items: str(undefined, { minLength: 1, maxLength: 32 }),
        },
        summary: str('What changed, in plain language.', { minLength: 1, maxLength: 500 }),
      },
      ['summary'],
    ),
  async handler(ctx, deps, input) {
    const refusal = refuseAfterQuestion(ctx);
    if (refusal) return refusal;
    const current = await deps.blueprints.getBlueprint(ctx.blueprintId);
    const { summary, ...changes } = input;
    if (changes.name !== undefined && changes.name !== current.name) {
      try {
        await deps.blueprints.assertNameFree(current.channelId, changes.name, current.id);
      } catch (error) {
        if (error instanceof ConflictException) {
          return {
            ok: false,
            error: `A blueprint named "${changes.name}" already exists in this channel.`,
          };
        }
        throw error;
      }
    }
    return {
      ok: true,
      result: { status: 'proposed' },
      item: {
        type: 'proposal',
        payload: {
          kind: 'metadata',
          changes,
          previous: { name: current.name, description: current.description, tags: current.tags },
          summary,
        },
      },
    };
  },
};

export const WRITE_TOOLS: AssistantTool<never>[] = [
  proposeDraft,
  updateMetadata,
] as unknown as AssistantTool<never>[];
