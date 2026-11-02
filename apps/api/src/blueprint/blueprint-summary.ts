import { blueprintPhases, type BlueprintVersionSummary, type StageDef } from '@reelcraft/shared';

/** The current version's columns `BlueprintService` reads alongside a blueprint row (a left
 * join, so `null` before the first save). Only this one version is loaded, never the list. */
export type CurrentVersionColumns = { major: number; minor: number; graph: unknown };

/** `BlueprintDto.latestVersion`: what a blueprint card shows of its current saved version. */
export function summarizeCurrentVersion(
  current: CurrentVersionColumns | null,
): BlueprintVersionSummary | null {
  if (!current) return null;
  const graph = Array.isArray(current.graph) ? (current.graph as StageDef[]) : [];
  return {
    major: current.major,
    minor: current.minor,
    stageCount: graph.length,
    phases: blueprintPhases(graph),
  };
}
