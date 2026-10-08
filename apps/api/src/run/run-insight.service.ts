import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import {
  artifact,
  artifactAttachment,
  blob,
  blueprintVersion,
  ledgerEntry,
  run,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../db/schema/index';
import { toUsd } from '../common/money';
import { mergeLayer } from '../run-config/layer-merge';
import type { ConfigLayer } from '@reelcraft/shared';

/**
 * Read-only views of a blueprint's runs for the blueprint assistant. Every method is scoped to one
 * blueprint (`run ⋈ blueprint_version`), so a run id from another blueprint, or a made-up one,
 * simply isn't found. Nothing here exposes blob ids, URLs, rendered inputs or provider handles:
 * the assistant is told what happened, not given the means to reach the files.
 *
 * `RunService.get()` is deliberately not reused: it presigns URLs, returns raw numeric-string
 * money and takes only a run id.
 */

export interface RunBrief {
  runId: string;
  /** "1.2", or "canvas draft" for a run of unsaved canvas edits. */
  version: string;
  dryRun: boolean;
  state: string;
  startedAt: string;
  endedAt: string | null;
  spentUsd: number;
  budgetCapUsd: number;
  /** The stage the run stopped at, when it did not complete. */
  stoppedAt: string | null;
  failure: unknown;
}

export interface StageCost {
  output: number;
  qc: number;
  check: number;
  total: number;
}

export interface StageSummary {
  key: string;
  label: string;
  capability: string;
  /** `not started` when the run never created an execution for the stage. */
  state: string;
  model: string | null;
  attempts: number;
  outcomes: Record<string, number>;
  costUsd: StageCost;
  failure: unknown;
  items?: {
    count: number;
    byState: Record<string, number>;
    failed: Array<{ itemIndex: number; reason: unknown }>;
  };
}

export interface RunInsight extends RunBrief {
  inputs: unknown;
  stages: StageSummary[];
}

export interface AttemptView {
  attemptNo: number;
  itemIndex: number | null;
  outcome: string;
  actor: string;
  costUsd: number;
  durationMs: number | null;
  at: string;
  /** Provider error, QC-unavailable reason or the user's rejection note, by outcome. */
  note: string | null;
  checkResults: unknown;
  qcVerdict: unknown;
  artifactId: string | null;
}

export interface StageOutputView {
  itemIndex: number | null;
  fromAttempt: number;
  /** False when a later attempt replaced it (for example it was rejected by a check). */
  current: boolean;
  kind: string;
  data: unknown;
  probe: unknown;
  attachments: Array<{ role: string; mime: string; bytes: number }>;
}

export interface StageInsight {
  stageKey: string;
  label: string;
  capability: string;
  state: string;
  failure: unknown;
  model: string | null;
  /** The run's resolved config for the stage with the run's overrides on top. */
  effectiveConfig: ConfigLayer;
  attemptCount: number;
  attempts: AttemptView[];
  outputs: StageOutputView[];
  outputsOmitted: number;
  prompt: { attemptNo: number; text: string } | null;
}

export type StageLookup =
  { found: false; stageKeys: string[] } | { found: true; stage: StageInsight };

/** A media output of a stage, for the preview service to turn into pictures. */
export interface MediaTarget {
  itemIndex: number | null;
  artifactId: string;
  kind: string;
  blobId: string | null;
  probe: unknown;
  /** `media.video_list`: the clips, by label and duration. */
  clips: Array<{ index: number; label: string; durationSec: number | null }>;
}

export type MediaLookup =
  { found: false; stageKeys: string[] } | { found: true; stageKey: string; targets: MediaTarget[] };

/** At most this many attempts and items are returned. */
const MAX_ATTEMPTS = 10;
const MAX_ITEMS = 5;

type StageGraphEntry = { key: string; label: string; capability: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The graph is stored as jsonb; old versions may not match today's StageDef, so read it loosely. */
function graphOf(value: unknown): StageGraphEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    const stage = asRecord(s);
    return typeof stage.key === 'string'
      ? [
          {
            key: stage.key,
            label: typeof stage.label === 'string' ? stage.label : stage.key,
            capability: typeof stage.capability === 'string' ? stage.capability : 'unknown',
          },
        ]
      : [];
  });
}

function modelOf(layer: ConfigLayer | undefined): string | null {
  const model = asRecord(layer?.model);
  return typeof model.provider === 'string' && typeof model.modelId === 'string'
    ? `${model.provider}/${model.modelId}`
    : null;
}

@Injectable()
export class RunInsightService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async listForBlueprint(
    blueprintId: string,
    limit: number,
  ): Promise<{ runs: RunBrief[]; total: number }> {
    const rows = await this.db
      .select({ run, version: blueprintVersion })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(blueprintVersion.blueprintId, blueprintId))
      .orderBy(desc(run.startedAt))
      .limit(limit);
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(blueprintVersion.blueprintId, blueprintId));
    return { runs: rows.map((r) => this.brief(r.run, r.version)), total };
  }

  /** `runId` omitted means the blueprint's latest run. */
  async getForBlueprint(blueprintId: string, runId?: string): Promise<RunInsight | null> {
    const owned = await this.ownedRun(blueprintId, runId);
    if (!owned) return null;
    const graph = graphOf(owned.version.graph);
    const executions = await this.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.runId, owned.run.id));
    const executionIds = executions.map((e) => e.id);

    const outcomeRows = executionIds.length
      ? await this.db
          .select({
            executionId: stageAttempt.stageExecutionId,
            outcome: stageAttempt.outcome,
            n: sql<number>`count(*)::int`,
          })
          .from(stageAttempt)
          .where(inArray(stageAttempt.stageExecutionId, executionIds))
          .groupBy(stageAttempt.stageExecutionId, stageAttempt.outcome)
      : [];
    const costRows = await this.db
      .select({
        stageKey: ledgerEntry.stageKey,
        category: ledgerEntry.category,
        total: sql<string>`sum(${ledgerEntry.amountUsd})`,
      })
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.runId, owned.run.id), eq(ledgerEntry.kind, 'actual')))
      .groupBy(ledgerEntry.stageKey, ledgerEntry.category);

    const iteratingIds = executions.filter((e) => e.isIterating).map((e) => e.id);
    const items = iteratingIds.length
      ? await this.db
          .select()
          .from(stageItem)
          .where(inArray(stageItem.stageExecutionId, iteratingIds))
          .orderBy(asc(stageItem.itemIndex))
      : [];

    const resolved = asRecord(owned.run.resolvedConfig);
    const overrides = asRecord(owned.run.overrides);
    const stages = graph.map((entry): StageSummary => {
      const execution = executions.find((e) => e.stageKey === entry.key);
      const layer = mergeLayer(
        asRecord(resolved[entry.key]) as ConfigLayer,
        asRecord(overrides[entry.key]) as ConfigLayer,
      );
      const outcomes: Record<string, number> = {};
      for (const row of outcomeRows) {
        if (row.executionId === execution?.id) outcomes[row.outcome] = row.n;
      }
      const costUsd: StageCost = { output: 0, qc: 0, check: 0, total: 0 };
      for (const row of costRows) {
        if (row.stageKey !== entry.key) continue;
        const amount = toUsd(row.total);
        costUsd[row.category === 'stage_output' ? 'output' : row.category] += amount;
        costUsd.total += amount;
      }
      const summary: StageSummary = {
        ...entry,
        state: execution?.state ?? 'not started',
        model: modelOf(layer),
        attempts: execution?.attemptCount ?? 0,
        outcomes,
        costUsd,
        failure: execution?.failure ?? null,
      };
      if (execution?.isIterating) {
        const own = items.filter((i) => i.stageExecutionId === execution.id);
        const byState: Record<string, number> = {};
        for (const item of own) byState[item.state] = (byState[item.state] ?? 0) + 1;
        summary.items = {
          count: execution.itemCount ?? own.length,
          byState,
          failed: own
            .filter((i) => i.state === 'failed')
            .slice(0, MAX_ITEMS)
            .map((i) => ({ itemIndex: i.itemIndex, reason: i.failure })),
        };
      }
      return summary;
    });
    return { ...this.brief(owned.run, owned.version), inputs: owned.run.inputs, stages };
  }

  async stageForBlueprint(
    blueprintId: string,
    runId: string,
    stageKey: string,
    options: { itemIndex?: number | undefined; includePrompt?: boolean | undefined },
  ): Promise<StageLookup | null> {
    const owned = await this.ownedRun(blueprintId, runId);
    if (!owned) return null;
    const graph = graphOf(owned.version.graph);
    const entry = graph.find((s) => s.key === stageKey);
    if (!entry) return { found: false, stageKeys: graph.map((s) => s.key) };

    const [execution] = await this.db
      .select()
      .from(stageExecution)
      .where(and(eq(stageExecution.runId, owned.run.id), eq(stageExecution.stageKey, stageKey)))
      .limit(1);
    const resolved = asRecord(owned.run.resolvedConfig);
    const overrides = asRecord(owned.run.overrides);
    const effectiveConfig = mergeLayer(
      asRecord(resolved[stageKey]) as ConfigLayer,
      asRecord(overrides[stageKey]) as ConfigLayer,
    );
    const base = {
      stageKey,
      label: entry.label,
      capability: entry.capability,
      effectiveConfig,
      model: modelOf(effectiveConfig),
    };
    if (!execution) {
      return {
        found: true,
        stage: {
          ...base,
          state: 'not started',
          failure: null,
          attemptCount: 0,
          attempts: [],
          outputs: [],
          outputsOmitted: 0,
          prompt: null,
        },
      };
    }

    const itemFilter =
      options.itemIndex === undefined ? undefined : eq(stageItem.itemIndex, options.itemIndex);
    const attemptRows = await this.db
      .select({
        attempt: stageAttempt,
        itemIndex: stageItem.itemIndex,
        artifact: {
          id: artifact.id,
          kind: artifact.kind,
          data: artifact.data,
          probe: artifact.probe,
          stale: artifact.stale,
        },
      })
      .from(stageAttempt)
      .leftJoin(stageItem, eq(stageAttempt.stageItemId, stageItem.id))
      .leftJoin(artifact, eq(stageAttempt.artifactId, artifact.id))
      .where(and(eq(stageAttempt.stageExecutionId, execution.id), itemFilter))
      .orderBy(desc(stageAttempt.attemptNo));

    const latest = attemptRows.slice(0, MAX_ATTEMPTS);
    const attempts = latest.map((r): AttemptView => ({
      attemptNo: r.attempt.attemptNo,
      itemIndex: r.itemIndex ?? null,
      outcome: r.attempt.outcome,
      actor: r.attempt.actor,
      costUsd: toUsd(r.attempt.costUsd),
      durationMs: r.attempt.durationMs,
      at: r.attempt.createdAt,
      note: r.attempt.reviewNote,
      checkResults: r.attempt.checkResults,
      qcVerdict: r.attempt.qcVerdict,
      artifactId: r.artifact?.id ?? null,
    }));

    // each item's most recent attempt that produced something (a rejected output is still shown)
    const byItem = new Map<number | null, (typeof attemptRows)[number]>();
    for (const r of attemptRows) {
      const key = r.itemIndex ?? null;
      if (r.artifact?.id && !byItem.has(key)) byItem.set(key, r);
    }
    const ordered = [...byItem.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1));
    const shown = options.itemIndex === undefined ? ordered.slice(0, MAX_ITEMS) : ordered;
    const attachments = shown.length
      ? await this.db
          .select({
            artifactId: artifactAttachment.artifactId,
            role: artifactAttachment.role,
            mime: blob.mime,
            bytes: blob.bytes,
          })
          .from(artifactAttachment)
          .innerJoin(blob, eq(artifactAttachment.blobId, blob.id))
          .where(
            inArray(
              artifactAttachment.artifactId,
              shown.map(([, r]) => r.artifact!.id),
            ),
          )
      : [];
    const outputs = shown.map(([itemIndex, r]): StageOutputView => {
      const art = r.artifact!;
      return {
        itemIndex,
        fromAttempt: r.attempt.attemptNo,
        current: !art.stale,
        kind: art.kind,
        data: art.data,
        probe: art.probe,
        attachments: attachments
          .filter((a) => a.artifactId === art.id)
          .map((a) => ({ role: a.role, mime: a.mime, bytes: a.bytes })),
      };
    });

    const promptRow = attemptRows.find((r) => r.attempt.renderedPrompt);
    return {
      found: true,
      stage: {
        ...base,
        state: execution.state,
        failure: execution.failure,
        attemptCount: attemptRows.length,
        attempts,
        outputs,
        outputsOmitted: ordered.length - shown.length,
        prompt:
          options.includePrompt && promptRow
            ? { attemptNo: promptRow.attempt.attemptNo, text: promptRow.attempt.renderedPrompt! }
            : null,
      },
    };
  }

  /** The media outputs of a stage (its current artifacts), for pictures. */
  async mediaForBlueprint(
    blueprintId: string,
    runId: string,
    stageKey: string,
    itemIndex?: number,
  ): Promise<MediaLookup | null> {
    const owned = await this.ownedRun(blueprintId, runId);
    if (!owned) return null;
    const graph = graphOf(owned.version.graph);
    if (!graph.some((s) => s.key === stageKey)) {
      return { found: false, stageKeys: graph.map((s) => s.key) };
    }
    const rows = await this.db
      .select()
      .from(artifact)
      .where(
        and(
          eq(artifact.runId, owned.run.id),
          eq(artifact.producerStageKey, stageKey),
          eq(artifact.stale, false),
          itemIndex === undefined ? undefined : eq(artifact.itemIndex, itemIndex),
        ),
      )
      .orderBy(asc(artifact.itemIndex));
    return {
      found: true,
      stageKey,
      targets: rows.map((a): MediaTarget => {
        const clips = Array.isArray(asRecord(a.data).clips)
          ? (asRecord(a.data).clips as unknown[]).map((c) => {
              const clip = asRecord(c);
              const probe = asRecord(clip.probe);
              return {
                index: typeof clip.index === 'number' ? clip.index : 0,
                label: typeof clip.label === 'string' ? clip.label : '',
                durationSec: typeof probe.durationSec === 'number' ? probe.durationSec : null,
              };
            })
          : [];
        return {
          itemIndex: a.itemIndex,
          artifactId: a.id,
          kind: a.kind,
          blobId: a.blobId,
          probe: a.probe,
          clips,
        };
      }),
    };
  }

  private async ownedRun(blueprintId: string, runId?: string) {
    const [row] = await this.db
      .select({ run, version: blueprintVersion })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(
        and(
          eq(blueprintVersion.blueprintId, blueprintId),
          runId === undefined ? undefined : eq(run.id, runId),
        ),
      )
      .orderBy(desc(run.startedAt))
      .limit(1);
    return row ?? null;
  }

  private brief(r: typeof run.$inferSelect, v: typeof blueprintVersion.$inferSelect): RunBrief {
    return {
      runId: r.id,
      version: v.draft ? 'canvas draft' : `${v.major}.${v.minor}`,
      dryRun: r.dryRun,
      state: r.state,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      spentUsd: toUsd(r.spentUsd),
      budgetCapUsd: toUsd(r.budgetCapUsd),
      stoppedAt: r.state === 'COMPLETED' ? null : r.cursorStageKey,
      failure: r.failure ?? null,
    };
  }
}
