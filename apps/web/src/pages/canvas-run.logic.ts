import type { CreateRunDto, RunDetailDto, SeedPlanDto, SeedStop } from '@reelcraft/shared';

/** Pure DTO builders for the canvas run dock's three actions — kept
 * separate from `useCanvasRunActions.ts` so they're testable without React.
 * `source` is the run whose finished stages should be reused
 * (`RunService.create`'s `seedFromRunId` — see run-seed.ts on the API side);
 * no source run yet is handled by the caller falling back to
 * `RunLaunchDialog` instead of calling these. */
export type CanvasRunSource = Pick<
  RunDetailDto,
  'id' | 'channelId' | 'roleBindings' | 'budgetCapUsd'
>;

/** `RunDetailDto.roleBindings` starts as `CreateRunDto`'s own `{roleKey:
 * characterId}` (a run still `CREATED`) and is replaced by `start()` with an
 * immutable `{roleKey: {characterId, name, description, references}}`
 * snapshot (`run.service.ts`'s `resolveRoleBindings`) — handle both so a
 * seeded run can be built from a source run in either state. */
function extractRoleCharacterIds(roleBindings: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(roleBindings)) {
    if (typeof value === 'string') result[key] = value;
    else if (value && typeof value === 'object' && 'characterId' in value) {
      result[key] = (value as { characterId: string }).characterId;
    }
  }
  return result;
}

function fromSource(
  source: CanvasRunSource,
  blueprintVersionId: string,
): Omit<CreateRunDto, 'inputs' | 'rerunStageKeys' | 'seedFromRunId' | 'untilStageKey'> {
  return {
    channelId: source.channelId,
    blueprintVersionId,
    roleBindings: extractRoleCharacterIds(source.roleBindings),
    // `RunDetailDto.budgetCapUsd` is typed `number` but arrives as a raw
    // Postgres numeric string at runtime (same gap `RunPage.tsx`'s `rerun`
    // mutation already works around with `Number(run!.budgetCapUsd)`) — the
    // server's `CreateRunDto.budgetCapUsd` validates strictly as a number.
    budgetCapUsd: Number(source.budgetCapUsd),
  };
}

/** "Run this stage" — reuse everything reusable up to `stageKey`, force
 * `stageKey` itself to run even if it would otherwise be considered
 * unchanged (the user clicked it because they want a fresh result), and
 * stop right after it. The server refuses (409 `upstream_rerun`) if that
 * would also re-run an earlier stage, unless `anyway` says that is fine. */
export function buildRunStageDto(
  source: CanvasRunSource,
  blueprintVersionId: string,
  stageKey: string,
  { anyway = false }: { anyway?: boolean | undefined } = {},
): CreateRunDto {
  return {
    ...fromSource(source, blueprintVersionId),
    inputs: {},
    seedFromRunId: source.id,
    rerunStageKeys: [stageKey],
    untilStageKey: stageKey,
    ...(!anyway && { expectReusedBefore: stageKey }),
  };
}

/** The reuse plan out of a 409 `upstream_rerun` rejection (`ApiError.issues`
 * carries the response body), or undefined for any other error. */
export function upstreamRerunPlan(error: unknown): SeedPlanDto | undefined {
  const { status, issues } = (error ?? {}) as { status?: unknown; issues?: unknown };
  if (status !== 409 || !issues || typeof issues !== 'object') return undefined;
  const { code, plan } = issues as { code?: unknown; plan?: SeedPlanDto };
  return code === 'upstream_rerun' && plan?.stop ? plan : undefined;
}

/** Why an earlier stage has to run again, as a sentence about `stageLabel`
 * (no trailing period). Shared by the run confirmation and the play-button
 * hint. */
export function describeSeedStop(stop: SeedStop, stageLabel: string): string {
  const name = `"${stageLabel}"`;
  switch (stop.reason) {
    case 'roles_changed':
      return "The blueprint's roles changed since the current run";
    case 'definition_changed':
      return `${name} changed since the current run`;
    case 'config_changed':
      return `${name}'s settings changed since the current run`;
    case 'assets_changed':
      return `An asset ${name} uses changed since the current run`;
    case 'not_in_source':
      return `${name} is not part of the current run`;
    case 'awaiting_approval':
      return `${name} is waiting for your review`;
    case 'awaiting_input':
      return `${name} is waiting for your input`;
    case 'failed':
      return `${name} failed in the current run`;
    case 'cancelled':
      return `${name} was cancelled in the current run`;
    case 'not_run':
      return `${name} has not finished running in the current run`;
    case 'items_incomplete':
      return `Some items of ${name} have not finished in the current run`;
    case 'rerun_requested':
      return `${name} was asked to run again`;
  }
}

/** "Run all" — reuse everything reusable, run every stage after that. */
export function buildRunAllDto(source: CanvasRunSource, blueprintVersionId: string): CreateRunDto {
  return {
    ...fromSource(source, blueprintVersionId),
    inputs: {},
    seedFromRunId: source.id,
    rerunStageKeys: [],
  };
}
