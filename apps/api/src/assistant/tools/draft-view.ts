import type { CreateBlueprintVersionDto, StageDef } from '@reelcraft/shared';

/** A draft whose stages serialise to more than this is shown as an outline. Claude Code writes an
 * MCP result over 50,000 characters to a file the assistant can't open (see
 * `assistant-tool-server.ts`), and even a result that fits makes the model read, and for
 * `propose_draft` write back, every stage to change one. Outline plus `get_stages` and
 * `edit_draft` keeps each call small and leaves the stages the user didn't mention untouched. */
export const INLINE_DRAFT_CHARS = 20_000;

/** The most `get_stages` returns in one call: under Claude Code's 50,000-character limit. */
export const STAGES_CALL_CHARS = 40_000;

const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

/** One line per stage: enough to find a stage and see how it connects, without its prompts,
 * schemas or config. `chars` is what `get_stages` would cost for it. */
export function stageOutline(stage: StageDef) {
  const model = stage.model?.provider
    ? `${stage.model.provider}/${stage.model.modelId ?? ''}`
    : undefined;
  return {
    key: stage.key,
    label: stage.label,
    capability: stage.capability,
    ...(stage.dependsOn && { dependsOn: stage.dependsOn }),
    ...(stage.iterate && { iterates: true }),
    ...(stage.approval && { approval: stage.approval.mode }),
    ...(stage.checks.length > 0 && { checks: stage.checks.length }),
    ...(stage.qc && { qc: true }),
    ...(stage.disabled && { disabled: true }),
    ...(stage.enabledWhen && { enabledWhen: stage.enabledWhen }),
    ...(stage.writes &&
      Object.keys(stage.writes).length > 0 && { writes: Object.keys(stage.writes) }),
    output: stage.output.kind,
    ...(model && { model }),
    chars: size(stage),
  };
}

export type StageOutline = ReturnType<typeof stageOutline>;

/** How a tool presents a draft: the whole thing when it is small enough, otherwise everything
 * except the stages' contents (which `get_stages` reads) plus the outline. The outline is
 * always included, so the order and wiring of the stages is visible either way. */
export function draftView(draft: CreateBlueprintVersionDto) {
  const outline = draft.graph.map(stageOutline);
  const chars = size(draft);
  if (chars <= INLINE_DRAFT_CHARS) return { draft, outline } as const;
  const rest: Omit<CreateBlueprintVersionDto, 'graph'> & { graph?: unknown } = { ...draft };
  delete rest.graph;
  return {
    draft: null,
    draftFields: rest,
    draftOmitted: `The draft is ${chars} characters (${draft.graph.length} stages), too large to return in one piece. The stage outline is below. Read the stages you need with get_stages and change them with edit_draft; use propose_draft only to build a new draft from scratch.`,
    outline,
  } as const;
}
