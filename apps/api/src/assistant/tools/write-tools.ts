import { z } from 'zod';
import { BlueprintMetadataChanges, type CreateBlueprintVersionDto } from '@reelcraft/shared';
import { ConflictException } from '@nestjs/common';
import { baselineDraft, currentDraft } from './current-draft';
import { confirmChange, turnEnded } from './gate';
import { applyDraftOps, DRAFT_FIELDS, DRAFT_OPS, DraftOp } from './draft-ops';
import { qualityIssues } from './quality-checks';
import { parseDraft } from './draft-checks';
import { draftJsonSchema, freeObject, obj, stageJsonSchema, str } from './json-schemas';
import type { AssistantTool, ToolDeps, TurnContext, ToolOutcome } from './types';

const BLUEPRINT_ID = str('The blueprint to change (an id from list_blueprints or the context).', {
  minLength: 1,
});

const ProposeInput = z.object({
  blueprintId: z.string().min(1),
  draft: z.unknown(),
  summary: z.string().min(1).max(500),
});

const proposeDraft: AssistantTool<z.infer<typeof ProposeInput>> = {
  name: 'propose_draft',
  kind: 'change',
  description:
    "Replace a blueprint's draft with a COMPLETE new one: for a new blueprint or a rewrite. To change an existing blueprint use edit_draft instead (always, when it is large). It is validated first: if it has any error you get the issues back and nothing changes, so fix them and call again. A valid draft becomes the blueprint's unsaved draft (the editor shows it, the user can Undo). It is not a saved version: runs of a saved version don't see it. summary: one or two plain sentences on what changed and why.",
  input: ProposeInput,
  jsonSchema: (n) =>
    obj(
      {
        blueprintId: BLUEPRINT_ID,
        draft: draftJsonSchema(n),
        summary: str('What changed, in plain language.', { minLength: 1, maxLength: 500 }),
      },
      ['blueprintId', 'draft', 'summary'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const parsed = parseDraft(input.draft);
    if (!parsed.ok)
      return { ok: false, error: 'The draft has the wrong shape.', issues: parsed.issues };
    const { draft: before } = await currentDraft(ctx, deps, input.blueprintId);
    return submitDraft(
      'propose_draft',
      ctx,
      deps,
      input.blueprintId,
      before,
      parsed.draft,
      input.summary,
    );
  },
};

const EditInput = z.object({
  blueprintId: z.string().min(1),
  ops: z.array(DraftOp).min(1).max(60),
  summary: z.string().min(1).max(500),
});

const editDraft: AssistantTool<z.infer<typeof EditInput>> = {
  name: 'edit_draft',
  kind: 'change',
  description:
    "Change a blueprint's CURRENT draft (what the editor shows, including your earlier edits) with a list of small edits instead of resending it: remove_stage, add_stage (after a stage, or at the end), replace_stage, update_stage (set or unset fields of one stage, e.g. set approval, unset qc) and set_draft_field (inputs, roles, defaults, budget, execution, presentation). The edits are applied together, then the result is validated and written exactly like propose_draft; if anything is wrong you get the issues back and nothing changes. Use this for any change to an existing blueprint, and always for a large one: you do not need to read or resend the stages you leave alone. Remember to fix what a removed stage leaves behind (stages that listed it in dependsOn or read its memory keys). summary: one or two plain sentences on what changed and why.",
  input: EditInput,
  jsonSchema: (n) =>
    obj(
      {
        blueprintId: BLUEPRINT_ID,
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          description: 'Applied in order.',
          items: obj(
            {
              op: str('The kind of edit.', { enum: [...DRAFT_OPS] }),
              key: str('remove_stage, replace_stage, update_stage: the stage to change.'),
              stage: stageJsonSchema(n),
              after: str('add_stage: key of the stage to insert after; omit to add at the end.'),
              set: freeObject('update_stage: stage field → new value (replaces the whole field).'),
              unset: {
                type: 'array',
                items: { type: 'string' },
                description: 'update_stage: stage fields to remove.',
              },
              field: str('set_draft_field: which draft field.', { enum: [...DRAFT_FIELDS] }),
              value: {
                description: 'set_draft_field: the new value; null clears presentation/execution.',
              },
            },
            ['op'],
          ),
        },
        summary: str('What changed, in plain language.', { minLength: 1, maxLength: 500 }),
      },
      ['blueprintId', 'ops', 'summary'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const { draft: before } = await currentDraft(ctx, deps, input.blueprintId);
    const applied = applyDraftOps(before, input.ops);
    if (!applied.ok) return { ok: false, error: applied.error };
    const parsed = parseDraft(applied.draft);
    if (!parsed.ok)
      return { ok: false, error: 'The edited draft has the wrong shape.', issues: parsed.issues };
    return submitDraft(
      'edit_draft',
      ctx,
      deps,
      input.blueprintId,
      before,
      parsed.draft,
      input.summary,
    );
  },
};

/** Validates a draft, asks (Manual mode), then writes it as the blueprint's working draft: the
 * shared end of `propose_draft` and `edit_draft`. */
async function submitDraft(
  tool: string,
  ctx: TurnContext,
  deps: ToolDeps,
  blueprintId: string,
  before: CreateBlueprintVersionDto,
  draft: CreateBlueprintVersionDto,
  summary: string,
): Promise<ToolOutcome> {
  const blueprint = await deps.blueprints.getBlueprint(blueprintId);
  const validation = await deps.blueprints.validateOnly(blueprintId, draft);
  const issues = [
    ...validation.issues,
    ...qualityIssues(draft, await baselineDraft(ctx, deps, blueprintId)),
  ];
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    return {
      ok: false,
      error: `The draft has ${errors.length} error(s). Fix them and try again.`,
      issues,
    };
  }
  const warnings = issues.filter((i) => i.severity === 'warning');
  const change = {
    kind: 'draft' as const,
    blueprintId,
    blueprintName: blueprint.name,
    summary,
    before,
    after: draft,
    warnings,
  };
  const refused = await confirmChange(ctx, {
    tool,
    kind: 'change',
    title: `Change the blueprint "${blueprint.name}"`,
    details: [summary],
    change,
  });
  if (refused) return refused;
  try {
    await deps.blueprints.setWorkingDraft(blueprintId, draft, blueprint.currentVersionId);
  } catch (error) {
    if (error instanceof ConflictException) {
      return {
        ok: false,
        error:
          'Someone saved a new version of this blueprint meanwhile, so nothing was written. Read it again with get_blueprint and redo the change.',
      };
    }
    throw error;
  }
  // From now on the server holds the newest draft, not the editor's copy.
  if (ctx.editorDraft?.blueprintId === blueprintId) ctx.editorDraft = null;
  deps.blueprintChanged(blueprintId);
  return {
    ok: true,
    result: {
      status: 'written',
      note: 'The blueprint now has this as its unsaved draft. Save a version before a production run needs it.',
      stageCount: draft.graph.length,
      warnings,
    },
    item: { type: 'change', payload: change },
  };
}

const MetadataInput = BlueprintMetadataChanges.extend({
  blueprintId: z.string().min(1),
  summary: z.string().min(1).max(500),
}).refine((v) => v.name !== undefined || v.description !== undefined || v.tags !== undefined, {
  message: 'Give at least one of name, description, tags.',
});

const updateMetadata: AssistantTool<z.infer<typeof MetadataInput>> = {
  name: 'update_metadata',
  kind: 'change',
  description:
    "Change a blueprint's name, description and/or tags (not part of the draft). Names must be unique in the channel. Takes effect at once (the user can Undo).",
  input: MetadataInput,
  jsonSchema: () =>
    obj(
      {
        blueprintId: BLUEPRINT_ID,
        name: str('New name', { minLength: 1, maxLength: 120 }),
        description: { type: ['string', 'null'], maxLength: 500, description: 'null clears it' },
        tags: {
          type: 'array',
          maxItems: 20,
          items: str(undefined, { minLength: 1, maxLength: 32 }),
        },
        summary: str('What changed, in plain language.', { minLength: 1, maxLength: 500 }),
      },
      ['blueprintId', 'summary'],
    ),
  async handler(ctx, deps, input) {
    const ended = turnEnded(ctx);
    if (ended) return ended;
    const { summary, blueprintId, ...changes } = input;
    const current = await deps.blueprints.getBlueprint(blueprintId);
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
    const change = {
      kind: 'metadata' as const,
      blueprintId,
      blueprintName: current.name,
      summary,
      changes,
      previous: { name: current.name, description: current.description, tags: current.tags },
    };
    const refused = await confirmChange(ctx, {
      tool: 'update_metadata',
      kind: 'change',
      title: `Rename or describe the blueprint "${current.name}"`,
      details: [summary],
      change,
    });
    if (refused) return refused;
    await deps.blueprints.update(blueprintId, changes);
    deps.blueprintChanged(blueprintId);
    return { ok: true, result: { status: 'changed' }, item: { type: 'change', payload: change } };
  },
};

export const WRITE_TOOLS: AssistantTool<never>[] = [
  proposeDraft,
  editDraft,
  updateMetadata,
] as unknown as AssistantTool<never>[];
