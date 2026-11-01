import type { StageDef } from '@reelcraft/shared';
import { stageDisplayName } from './stage-display-name';

/** The short "Script › Voice › Visuals" line for a blueprint: its phases (stage groups) in order,
 * or, for a blueprint without phases, its first few stage names. */
export function blueprintFlow(
  graph: Pick<StageDef, 'label' | 'key' | 'group'>[],
  max = 5,
): string[] {
  const phases: string[] = [];
  for (const stage of graph) {
    const group = stage.group?.trim();
    if (group && !phases.includes(group)) phases.push(group);
  }
  if (phases.length) return phases.slice(0, max);
  return graph.slice(0, max).map(stageDisplayName);
}
