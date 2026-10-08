import type { CreateBlueprintVersionDto } from '@reelcraft/shared';
import type { TurnContext, ToolDeps } from './types';

export const EMPTY_DRAFT: CreateBlueprintVersionDto = {
  graph: [],
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 0 },
};

export type DraftSource =
  'proposal in this turn' | 'canvas' | 'working draft' | 'latest saved version' | 'empty';

export async function currentDraft(
  ctx: TurnContext,
  deps: ToolDeps,
  { ignoreProposal = false }: { ignoreProposal?: boolean } = {},
): Promise<{ draft: CreateBlueprintVersionDto; source: DraftSource }> {
  if (ctx.lastProposal && !ignoreProposal)
    return { draft: ctx.lastProposal, source: 'proposal in this turn' };
  if (ctx.baseDraft) return { draft: ctx.baseDraft, source: 'canvas' };
  const blueprint = await deps.blueprints.getBlueprint(ctx.blueprintId);
  if (blueprint.workingDraft) {
    return { draft: blueprint.workingDraft as CreateBlueprintVersionDto, source: 'working draft' };
  }
  const [latest] = await deps.blueprints.listVersions(ctx.blueprintId);
  if (latest) {
    return {
      // jsonb columns come back untyped; they were validated when the version was saved
      draft: {
        graph: latest.graph,
        inputs: latest.inputs,
        roles: latest.roles,
        defaults: latest.defaults,
        budget: latest.budget,
      } as CreateBlueprintVersionDto,
      source: 'latest saved version',
    };
  }
  return { draft: EMPTY_DRAFT, source: 'empty' };
}

/** The draft the USER has (canvas, else working draft, else latest save), ignoring any proposal
 * the assistant made in this turn: what a proposal is measured against. */
export async function baselineDraft(
  ctx: TurnContext,
  deps: ToolDeps,
): Promise<CreateBlueprintVersionDto> {
  return (await currentDraft(ctx, deps, { ignoreProposal: true })).draft;
}
