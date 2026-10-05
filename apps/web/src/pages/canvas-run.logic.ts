import type { CreateRunDto, RunDetailDto } from '@reelcraft/shared';

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
 * stop right after it. */
export function buildRunStageDto(
  source: CanvasRunSource,
  blueprintVersionId: string,
  stageKey: string,
): CreateRunDto {
  return {
    ...fromSource(source, blueprintVersionId),
    inputs: {},
    seedFromRunId: source.id,
    rerunStageKeys: [stageKey],
    untilStageKey: stageKey,
  };
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
