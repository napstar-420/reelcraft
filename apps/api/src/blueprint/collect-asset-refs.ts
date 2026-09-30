import type { Ref, StageDef } from '@reelcraft/shared';

/** Walks every stage's slots/context/check-refs collecting every
 * `{from:'asset'}` ref's assetId — shared by save-time validation
 * (`blueprint.service.ts` builds `assetsById` for the validator) and
 * `run.service.ts`'s `start()` (snapshots `run.assetBindings`) so the two
 * can't drift on what "referenced" means. */
export function collectAssetIds(graph: StageDef[]): string[] {
  const ids = new Set<string>();
  const visit = (ref: Ref): void => {
    if (ref.from === 'asset') ids.add(ref.assetId);
  };
  for (const stage of graph) {
    for (const ref of Object.values(stage.slots)) visit(ref);
    for (const ref of Object.values(stage.context)) visit(ref);
    for (const check of stage.checks) {
      if (check.type === 'script' && check.refs) {
        for (const ref of Object.values(check.refs)) visit(ref);
      }
    }
  }
  return [...ids];
}

/** The role refs whose images a stage sends to its model: reference slots
 * plus attached Context. Shared by save-time and run-start reference-limit
 * checks so both count the same bindings. */
export function roleRefsOf(stage: StageDef): Array<Extract<Ref, { from: 'role' }>> {
  const attached = new Set(stage.attach ?? []);
  const refs = [
    ...Object.values(stage.slots),
    ...Object.entries(stage.context)
      .filter(([name]) => attached.has(name))
      .map(([, ref]) => ref),
  ];
  return refs.filter((ref): ref is Extract<Ref, { from: 'role' }> => ref.from === 'role');
}
