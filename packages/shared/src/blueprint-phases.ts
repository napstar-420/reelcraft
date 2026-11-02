import type { StageDef } from './stage-def';

/** A stage label's leading number, as blueprints often write it ("11 · Captions"). */
const LEADING_NUMBER = /^\s*\d+\s*[·.:)\-–—]\s*/;

/** The short "Script › Voice › Visuals" line for a blueprint card: each stage `group` once, in
 * order; for a graph without groups, its first stages' labels without a leading number (falling
 * back to the key). At most `max` entries. The web keeps a copy (`blueprintFlow()` in
 * `apps/web/src/lib/blueprint-flow.ts`) for unsaved drafts, since it can't import runtime values
 * from this package; keep the two in step. */
export function blueprintPhases(
  graph: Pick<StageDef, 'label' | 'key' | 'group'>[],
  max = 5,
): string[] {
  const phases: string[] = [];
  for (const stage of graph) {
    const group = stage.group?.trim();
    if (group && !phases.includes(group)) phases.push(group);
  }
  if (phases.length) return phases.slice(0, max);
  return graph.slice(0, max).map((stage) => (stage.label || stage.key).replace(LEADING_NUMBER, ''));
}
