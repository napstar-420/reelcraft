import type { CreateBlueprintVersionDto } from '@reelcraft/shared';
import type { TurnContext, ToolDeps } from './types';

export const EMPTY_DRAFT: CreateBlueprintVersionDto = {
  graph: [],
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 0 },
};

export type DraftSource = 'editor' | 'working draft' | 'latest saved version' | 'empty';

/** A blueprint's draft right now: the open editor's (sent with the turn), else its autosaved
 * working draft, else its latest saved version. The first read of a blueprint in a turn is also
 * remembered as its baseline. */
export async function currentDraft(
  ctx: TurnContext,
  deps: ToolDeps,
  blueprintId: string,
): Promise<{ draft: CreateBlueprintVersionDto; source: DraftSource }> {
  const found = await readDraft(ctx, deps, blueprintId);
  if (!ctx.baselines.has(blueprintId)) ctx.baselines.set(blueprintId, found.draft);
  return found;
}

async function readDraft(
  ctx: TurnContext,
  deps: ToolDeps,
  blueprintId: string,
): Promise<{ draft: CreateBlueprintVersionDto; source: DraftSource }> {
  if (ctx.editorDraft?.blueprintId === blueprintId) {
    return { draft: ctx.editorDraft.draft, source: 'editor' };
  }
  const blueprint = await deps.blueprints.getBlueprint(blueprintId);
  // A working draft saved against an older version is not what the editor shows.
  if (
    blueprint.workingDraft &&
    blueprint.workingDraftBaseVersionId === blueprint.currentVersionId
  ) {
    return { draft: blueprint.workingDraft as CreateBlueprintVersionDto, source: 'working draft' };
  }
  const [latest] = await deps.blueprints.listVersions(blueprintId);
  if (latest) {
    return {
      // jsonb columns come back untyped; they were validated when the version was saved
      draft: {
        graph: latest.graph,
        inputs: latest.inputs,
        roles: latest.roles,
        defaults: latest.defaults,
        budget: latest.budget,
        presentation: latest.presentation ?? undefined,
        execution: latest.execution,
      } as CreateBlueprintVersionDto,
      source: 'latest saved version',
    };
  }
  return { draft: EMPTY_DRAFT, source: 'empty' };
}

/** The blueprint's draft before this turn changed it: what a change is measured against. */
export async function baselineDraft(
  ctx: TurnContext,
  deps: ToolDeps,
  blueprintId: string,
): Promise<CreateBlueprintVersionDto> {
  return ctx.baselines.get(blueprintId) ?? (await currentDraft(ctx, deps, blueprintId)).draft;
}
