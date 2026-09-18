import type { RefProvenance } from '../artifact/binding-resolver.service';

export interface ActiveExecutionRead {
  stageKey: string;
  stageExecutionId: string;
  artifactId?: string;
  provenance: Record<string, RefProvenance>;
}

export interface MemoryVersionWriter {
  memoryKey: string;
  memoryVersion: number;
  stageKey: string;
  itemIndex?: number;
}

export interface InvalidationSeed {
  stageKeys?: string[];
  forcedStageKeys?: string[];
  artifactIds?: string[];
  inputKeys?: string[];
}

export interface InvalidationClosure {
  affectedStageKeys: string[];
  affectedExecutionIds: string[];
  affectedArtifactIds: string[];
}

/**
 * §15.2 — computes the dependency closure from the reads recorded by active
 * attempts. This is deliberately pure: the DB-facing service is responsible
 * for loading active attempts and memory-version writers, while this function
 * owns the easily unit-tested graph semantics.
 */
export function computeInvalidationClosure(params: {
  graphOrder: string[];
  executions: ActiveExecutionRead[];
  seed: InvalidationSeed;
  memoryVersionWriters: MemoryVersionWriter[];
}): InvalidationClosure {
  const byStage = new Map(params.executions.map((execution) => [execution.stageKey, execution]));
  const writerByVersion = new Map(
    params.memoryVersionWriters.map((writer) => [
      memoryVersionKey(writer.memoryKey, writer.memoryVersion),
      writer,
    ]),
  );

  const affectedStages = new Set([
    ...(params.seed.stageKeys ?? []),
    ...(params.seed.forcedStageKeys ?? []),
  ]);
  const affectedArtifacts = new Set(params.seed.artifactIds ?? []);
  const affectedInputs = new Set(params.seed.inputKeys ?? []);

  for (const stageKey of affectedStages) {
    const artifactId = byStage.get(stageKey)?.artifactId;
    if (artifactId) affectedArtifacts.add(artifactId);
  }

  // Graph order is execution order, and every legal dependency points
  // backward. One ordered pass therefore computes the transitive closure:
  // adding a stage also adds its artifact before any later reader is visited.
  for (const stageKey of params.graphOrder) {
    if (affectedStages.has(stageKey)) continue;
    const execution = byStage.get(stageKey);
    if (!execution) continue;

    const dependsOnAffected = Object.values(execution.provenance).some((read) => {
      if (read.artifactId && affectedArtifacts.has(read.artifactId)) return true;
      if (read.inputKey && affectedInputs.has(read.inputKey)) return true;
      if (read.memoryKey !== undefined && read.memoryVersion !== undefined) {
        const writer = writerByVersion.get(memoryVersionKey(read.memoryKey, read.memoryVersion));
        return writer !== undefined && affectedStages.has(writer.stageKey);
      }
      return false;
    });

    if (!dependsOnAffected) continue;
    affectedStages.add(stageKey);
    if (execution.artifactId) affectedArtifacts.add(execution.artifactId);
  }

  const orderedStageKeys = params.graphOrder.filter((stageKey) => affectedStages.has(stageKey));
  const orderedExecutions = orderedStageKeys
    .map((stageKey) => byStage.get(stageKey)?.stageExecutionId)
    .filter((id): id is string => id !== undefined);
  const orderedArtifacts = orderedStageKeys
    .map((stageKey) => byStage.get(stageKey)?.artifactId)
    .filter((id): id is string => id !== undefined);

  // A caller may seed an artifact without a corresponding active execution
  // (notably `$input:<key>`). Preserve those ids after graph-ordered outputs.
  for (const artifactId of affectedArtifacts) {
    if (!orderedArtifacts.includes(artifactId)) orderedArtifacts.push(artifactId);
  }

  return {
    affectedStageKeys: orderedStageKeys,
    affectedExecutionIds: orderedExecutions,
    affectedArtifactIds: orderedArtifacts,
  };
}

function memoryVersionKey(memoryKey: string, memoryVersion: number): string {
  return `${memoryKey}\u0000${memoryVersion}`;
}
