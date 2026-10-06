import type { Ref, StageDef } from '@reelcraft/shared';

/** Returns the graph with `fn` applied to every leaf ref: stage slots,
 * context, `iterate.over` and script-check refs, looking inside `coalesce`
 * branches. Shared by asset collection and by package export/import, which
 * swap local ids for slot placeholders and back. */
export function mapGraphRefs(graph: StageDef[], fn: (ref: Ref) => Ref): StageDef[] {
  const mapRef = (ref: Ref): Ref =>
    ref.from === 'coalesce' ? { ...ref, refs: ref.refs.map(mapRef) } : fn(ref);
  const mapRecord = (record: Record<string, Ref>): Record<string, Ref> =>
    Object.fromEntries(Object.entries(record).map(([key, ref]) => [key, mapRef(ref)]));
  return graph.map((stage) => ({
    ...stage,
    slots: mapRecord(stage.slots),
    context: mapRecord(stage.context),
    ...(stage.iterate ? { iterate: { ...stage.iterate, over: mapRef(stage.iterate.over) } } : {}),
    checks: stage.checks.map((check) =>
      check.type === 'script' && check.refs ? { ...check, refs: mapRecord(check.refs) } : check,
    ),
  }));
}

/** Every `{from:'asset'}` ref's assetId — shared by save-time validation
 * (`blueprint.service.ts` builds `assetsById` for the validator),
 * `run.service.ts`'s `start()` (snapshots `run.assetBindings`) and package
 * export, so they can't drift on what "referenced" means. */
export function collectAssetIds(graph: StageDef[]): string[] {
  const ids = new Set<string>();
  mapGraphRefs(graph, (ref) => {
    if (ref.from === 'asset') ids.add(ref.assetId);
    return ref;
  });
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
