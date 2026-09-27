import { eq, inArray } from 'drizzle-orm';
import { StageDef, type Probe } from '@reelcraft/shared';
import type { Db, Tx } from '../db/drizzle.provider';
import { artifact, blueprintVersion, run, stageExecution } from '../db/schema/index';

export interface FinalVideoResult {
  artifactId: string;
  blobId: string;
  probe: Probe | null;
  posterBlobId: string | null;
}

interface MinimalStageExecution {
  stageKey: string;
  state: string;
  outputArtifactId: string | null;
}

interface MinimalArtifact {
  id: string;
  kind: string;
  blobId: string | null;
  probe: unknown;
  derived?: unknown;
}

/**
 * A3 — a run has no explicit "this is the final output" flag; the last
 * video-producing stage in graph order is the closest deterministic proxy.
 * Pure so the walk logic is unit-testable without a database.
 */
export function pickFinalVideo(
  graphKeys: string[],
  executions: MinimalStageExecution[],
  artifactsById: Map<string, MinimalArtifact>,
): FinalVideoResult | null {
  const byKey = new Map(executions.map((e) => [e.stageKey, e]));
  for (let i = graphKeys.length - 1; i >= 0; i--) {
    const execution = byKey.get(graphKeys[i]!);
    if (!execution || execution.state !== 'passed' || !execution.outputArtifactId) continue;
    const artifactRow = artifactsById.get(execution.outputArtifactId);
    if (!artifactRow || artifactRow.kind !== 'media.video' || !artifactRow.blobId) continue;
    const derived = artifactRow.derived as Record<string, string> | null | undefined;
    return {
      artifactId: artifactRow.id,
      blobId: artifactRow.blobId,
      probe: (artifactRow.probe as Probe | null) ?? null,
      posterBlobId: derived?.poster ?? null,
    };
  }
  return null;
}

export async function findFinalVideo(db: Db | Tx, runId: string): Promise<FinalVideoResult | null> {
  const [row] = await db
    .select({ graph: blueprintVersion.graph })
    .from(run)
    .innerJoin(blueprintVersion, eq(blueprintVersion.id, run.blueprintVersionId))
    .where(eq(run.id, runId))
    .limit(1);
  if (!row) return null;
  const graph = StageDef.array().parse(row.graph);
  const graphKeys = graph.map((stage) => stage.key);

  const executions = await db
    .select({
      stageKey: stageExecution.stageKey,
      state: stageExecution.state,
      outputArtifactId: stageExecution.outputArtifactId,
    })
    .from(stageExecution)
    .where(eq(stageExecution.runId, runId));

  const artifactIds = executions
    .map((e) => e.outputArtifactId)
    .filter((id): id is string => id !== null);
  const artifacts = artifactIds.length
    ? await db
        .select({
          id: artifact.id,
          kind: artifact.kind,
          blobId: artifact.blobId,
          probe: artifact.probe,
          derived: artifact.derived,
        })
        .from(artifact)
        .where(inArray(artifact.id, artifactIds))
    : [];
  const artifactsById = new Map(artifacts.map((a) => [a.id, a]));

  return pickFinalVideo(graphKeys, executions, artifactsById);
}
