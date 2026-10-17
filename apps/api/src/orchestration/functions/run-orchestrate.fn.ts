import type { Inngest } from 'inngest';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { StageDef, stageDependencies } from '@reelcraft/shared';
import type { Db } from '../../db/drizzle.provider';
import { artifact, blueprintVersion, run, stageExecution, stageItem } from '../../db/schema/index';
import type { RunStateService } from '../run-state.service';
import { disabledAncestor } from '@reelcraft/shared';
import { isStageEnabled } from '../enabled-when';
import { buildStageExecuteFunction } from './stage-execute.fn';
import type { StageAttemptOutcome } from './stage-attempt-loop';
import type { HumanWaitService } from '../../run/human-wait.service';
import type { RunWakeupClaimService, RunWakeupEventData } from '../../run/run-wakeup-claim.service';
import type { DerivedFrameService } from '../../artifact/derived-frame.service';
import { findFinalVideo } from '../../artifact/final-video';
import type { NotificationService } from '../../notification/notification.service';
import type { NotificationKind } from '@reelcraft/shared';

/** Shared shape for both triggers below — `run/resumed` (§12.4, sent by
 * `RunService.resume()`) carries the identical `{runId}` payload. */
export interface RunStartedEventData {
  runId: string;
  executionEpoch?: number;
  executionKey?: string;
  wakeupId?: string;
  action?: RunWakeupEventData['action'];
  sourceState?: RunWakeupEventData['sourceState'];
  expectedRevision?: number;
}

/** §16.1 — sorts `stage_execution` rows into blueprint graph array order.
 * Pure and exported so the ordering fix is directly unit-testable without
 * needing an Inngest test driver: `stage_execution` carries no ordinal
 * column of its own, so this is the one place that decides execution order. */
export function orderStageExecutions<T extends { stageKey: string }>(
  graph: Pick<StageDef, 'key'>[],
  executions: T[],
): T[] {
  const order = new Map(graph.map((stage, index) => [stage.key, index]));
  return [...executions].sort(
    (a, b) => (order.get(a.stageKey) ?? 0) - (order.get(b.stageKey) ?? 0),
  );
}

/** What `planWave` needs to know about a stage execution. */
export interface WaveRow {
  stageKey: string;
  state: string;
  needsItemWork?: boolean;
  /** Stages this one waits for. Rows memoised before dependencies existed
   * carry none: they wait for the previous row, as a chain always did. */
  deps?: string[];
  /** A person still owes an answer (a live open wait). Rows memoised before
   * waits were read this way carry none: nothing is waiting. */
  openWait?: boolean;
}

/**
 * Which stages to start now. `settled` stages passed (with no item work left)
 * or were skipped; a stage is `done` once it and everything it waits for has
 * settled. `ready` stages are not done, not waiting on a person, and have every
 * dependency done. A stage waiting on a person is never re-entered: running it
 * again would redo provider work behind the open wait.
 *
 * In a chain this is always the first stage that is not done, which is what the
 * sequential loop used to pick.
 */
export function planWave<T extends WaveRow>(
  rows: T[],
): { ready: T[]; waiting: T[]; allDone: boolean } {
  const byKey = new Map(rows.map((row) => [row.stageKey, row]));
  const depsOf = (row: T, index: number): string[] =>
    row.deps ?? (index > 0 ? [rows[index - 1]!.stageKey] : []);
  const index = new Map(rows.map((row, i) => [row.stageKey, i]));
  const settled = (row: T): boolean =>
    row.state === 'skipped' || (row.state === 'passed' && !row.needsItemWork);

  const doneMemo = new Map<string, boolean>();
  const isDone = (key: string): boolean => {
    const row = byKey.get(key);
    if (!row) return true; // no execution row: nothing to wait for
    const known = doneMemo.get(key);
    if (known !== undefined) return known;
    doneMemo.set(key, false); // guards a cycle; the validator rejects those
    const done = settled(row) && depsOf(row, index.get(key)!).every(isDone);
    doneMemo.set(key, done);
    return done;
  };

  const ready: T[] = [];
  const waiting: T[] = [];
  rows.forEach((row, i) => {
    if (isDone(row.stageKey)) return;
    if (row.openWait === true) waiting.push(row);
    else if (
      !['failed', 'running', 'cancelled'].includes(row.state) &&
      depsOf(row, i).every(isDone)
    )
      ready.push(row);
  });
  return { ready, waiting, allDone: rows.every((row) => isDone(row.stageKey)) };
}

/** Durable bounded scheduling: retain dependencies outside the selected scope,
 * persist completion order, and refill a free stage slot without waiting for siblings.
 * Execution epochs fence resumed work from retired wakeups and cancellation events. */
export function buildRunOrchestrateFunction(
  client: Inngest,
  db: Db,
  runState: RunStateService,
  stageExecuteFn: ReturnType<typeof buildStageExecuteFunction>,
  wakeupClaim?: RunWakeupClaimService,
  derivedFrames?: DerivedFrameService,
  notifications?: NotificationService,
  waits?: HumanWaitService,
) {
  return client.createFunction(
    {
      id: 'run.orchestrate',
      concurrency: { limit: 1, key: 'event.data.runId' },
      cancelOn: [{ event: 'run/cancelled', match: 'data.executionKey' }],
    },
    [{ event: 'run/started' }, { event: 'run/resumed' }],
    async ({ event, step, logger, runId: invocationId }) => {
      const data = event.data as RunStartedEventData;
      const { runId } = data;

      // Notifications are appended right before each `return`, never between
      // existing steps: a step added mid-function would run for the first time
      // on a run already in flight when the API restarts, and announce
      // something that happened hours ago. The key makes a replay a no-op, and
      // a failure here must never change how the run ends (same stance as
      // `extract-poster` below).
      const notify = (kind: NotificationKind) =>
        step
          .run(`notify-${kind}`, () =>
            notifications?.notifyRun({
              runId,
              kind,
              dedupeKey: `${kind}:${data.wakeupId ?? invocationId}`,
            }),
          )
          .catch((err: unknown) => {
            logger.warn({ runId, kind, err }, 'notification step failed');
          });

      if (
        data.wakeupId &&
        data.action &&
        data.sourceState &&
        data.expectedRevision !== undefined &&
        wakeupClaim
      ) {
        const claim = await step.run('claim-wakeup', () =>
          wakeupClaim.claim(data as RunWakeupEventData),
        );
        if (!claim.claimed) {
          logger.info(
            { runId, wakeupId: data.wakeupId, action: data.action, reason: claim.reason },
            'run wakeup ignored',
          );
          return { ignored: true as const, reason: claim.reason };
        }
      } else {
        // Backward compatibility for already-enqueued events from before the
        // durable wakeup envelope was introduced.
        const admitted = await step.run('mark-running', () =>
          runState.admitLegacy(runId, data.executionEpoch ?? 0),
        );
        if (!admitted) return { ignored: true };
      }

      const settings = await step.run('load-execution-scope', async () => {
        const [owner] = await db.select().from(run).where(eq(run.id, runId));
        if (!owner) throw new Error('Run not found');
        return {
          scope: owner.executionScope,
          concurrency: owner.concurrentBranches,
          epoch: owner.executionEpoch,
        };
      });
      if (settings.epoch !== (data.executionEpoch ?? 0)) return { ignored: true };
      const executions = await step.run('load-stage-executions', async () => {
        const [row] = await db
          .select({ graph: blueprintVersion.graph, inputs: run.inputs })
          .from(run)
          .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
          .where(eq(run.id, runId))
          .limit(1);
        if (!row) throw new Error(`run.orchestrate: run ${runId} not found`);

        const graph = StageDef.array().parse(row.graph);
        const rows = await db.select().from(stageExecution).where(eq(stageExecution.runId, runId));

        // phase 7 chunk 5 — item-level invalidation can leave a
        // `stage_execution.state = 'passed'` row with some of its own
        // `stage_item` rows staled (only SOME items were invalidated, not
        // the whole stage — see `InvalidationService.apply()`). The bare
        // `state === 'passed'` skip below predates iteration and would
        // otherwise never re-enter that stage, silently stranding the
        // stale items forever. Load which iterating executions still have
        // non-passed items so the skip below can account for it.
        const iteratingIds = rows.filter((r) => r.isIterating).map((r) => r.id);
        const nonPassedItems =
          iteratingIds.length === 0
            ? []
            : await db
                .select({ stageExecutionId: stageItem.stageExecutionId })
                .from(stageItem)
                .where(
                  and(
                    inArray(stageItem.stageExecutionId, iteratingIds),
                    ne(stageItem.state, 'passed'),
                  ),
                );
        const executionIdsNeedingItemWork = new Set(nonPassedItems.map((r) => r.stageExecutionId));

        const inputs = (row.inputs ?? {}) as Record<string, unknown>;
        const enabledWhenByKey = new Map(graph.map((stage) => [stage.key, stage.enabledWhen]));
        const deps = stageDependencies(graph);
        const waitingExecutionIds = new Set(
          waits ? (await waits.liveOpenWaits(db, runId)).map((w) => w.stageExecutionId) : [],
        );
        return orderStageExecutions(graph, rows).map((r) => ({
          ...r,
          needsItemWork: executionIdsNeedingItemWork.has(r.id),
          enabled:
            isStageEnabled(enabledWhenByKey.get(r.stageKey), inputs) &&
            (!graph.find((s) => s.key === r.stageKey)?.disabled ||
              (settings.scope?.kind === 'selection' &&
                settings.scope.stageKeys.length === 1 &&
                settings.scope.stageKeys[0] === r.stageKey)),
          disabledAncestor: disabledAncestor(graph, r.stageKey)?.label,
          manuallyDisabled: graph.find((s) => s.key === r.stageKey)?.disabled ?? false,
          deps: deps.get(r.stageKey) ?? [],
          openWait: waitingExecutionIds.has(r.id),
        }));
      });

      logger.info(
        { runId, wakeupId: data.wakeupId, action: data.action, stageCount: executions.length },
        'run orchestration started',
      );

      // A run parks with the state that matches what it is waiting for. The
      // fallback is the state an older invocation recorded, so a replay of a
      // memoised park step still returns what it did.
      const pausedState = async (fallback: 'PAUSED_APPROVAL' | 'PAUSED_INPUT') =>
        (await waits?.pausedStateFor(db, runId)) ?? fallback;

      const rows = executions.map((execution) => ({
        ...execution,
        state: ['failed', 'cancelled', 'running'].includes(execution.state)
          ? 'pending'
          : execution.state,
      }));
      // Legacy partial runs used skipped as a scope marker; only selected scope is recovered.
      const selected = new Set(
        settings.scope?.stageKeys ??
          rows.filter((r) => r.state !== 'skipped' || r.enabled).map((r) => r.stageKey),
      );
      for (const row of rows)
        if (selected.has(row.stageKey) && row.state === 'skipped' && row.enabled && !row.skipReason)
          row.state = 'pending';
      type Result = StageAttemptOutcome | { outcome: 'input_required' };
      type Completion = { stageKey: string; result: Result; crashed?: boolean };
      const active = new Map<string, Promise<Completion>>();
      let completionNo = 0;
      let stopped: 'PAUSED_BUDGET' | 'PAUSED_QUOTA' | undefined;
      let resumeAt: string | undefined;
      let failed = false;
      let approval = false;
      let input = false;
      for (;;) {
        const admission = await step.run(`admission-${completionNo}`, async () => {
          const [owner] = await db
            .select({ state: run.state, epoch: run.executionEpoch })
            .from(run)
            .where(eq(run.id, runId));
          return owner;
        });
        if (!admission || admission.epoch !== settings.epoch) return { ignored: true };
        if (admission.state === 'RUNNING' && !stopped) {
          const ready = planWave(rows).ready.filter(
            (row) => selected.has(row.stageKey) && !row.disabledAncestor,
          );
          for (const execution of ready) {
            if (active.size >= settings.concurrency) break;
            if (!execution.enabled) {
              await step.run(`skip-disabled-${execution.stageKey}`, () =>
                runState.skipStage(
                  runId,
                  execution.id,
                  execution.stageKey,
                  settings.epoch,
                  execution.manuallyDisabled ? 'Stage disabled by user' : undefined,
                ),
              );
              execution.state = 'skipped';
              continue;
            }
            await step.run(`set-cursor-${execution.stageKey}`, () =>
              runState.setCursor(runId, execution.stageKey, settings.epoch),
            );
            execution.state = 'running';
            const invocation = step
              .invoke(`invoke-stage-${execution.stageKey}`, {
                function: stageExecuteFn,
                data: {
                  runId,
                  stageExecutionId: execution.id,
                  stageKey: execution.stageKey,
                  executionEpoch: settings.epoch,
                  executionKey: `${runId}:${settings.epoch}`,
                },
              })
              .then(
                (result) => ({ stageKey: execution.stageKey, result }),
                (error) => ({
                  stageKey: execution.stageKey,
                  crashed: true,
                  result: {
                    outcome: 'failed' as const,
                    reason: error instanceof Error ? error.message : String(error),
                  },
                }),
              );
            active.set(execution.stageKey, invocation);
          }
        }
        if (!active.size) {
          // Disabling a parent may have made its children ready without an invocation finishing.
          if (
            admission.state === 'RUNNING' &&
            !stopped &&
            planWave(rows).ready.some((r) => selected.has(r.stageKey))
          ) {
            completionNo++;
            continue;
          }
          if (admission.state === 'PAUSING') {
            await step.run('mark-paused-manual', () =>
              runState.transition(runId, 'PAUSED_MANUAL', settings.epoch),
            );
            return { state: 'PAUSED_MANUAL' as const };
          }
          if (admission.state !== 'RUNNING') return { state: admission.state };
          break;
        }
        const candidate = await Promise.race(active.values());
        // Persist completion order so replay makes the same slot-refill decisions.
        const completed = await step.run(`settled-${completionNo}`, () => candidate);
        completionNo++;
        active.delete(completed.stageKey);
        const row = rows.find((r) => r.stageKey === completed.stageKey)!;
        const result = completed.result ?? {
          outcome: 'failed' as const,
          reason: 'Stage invocation returned no result',
        };
        if (result.outcome === 'passed') {
          row.state = 'passed';
          row.needsItemWork = false;
        } else if (result.outcome === 'approval_required' || result.outcome === 'input_required') {
          row.openWait = true;
          row.state = 'awaiting_approval';
          approval ||= result.outcome === 'approval_required';
          input ||= result.outcome === 'input_required';
        } else if (result.outcome === 'budget_blocked') {
          stopped = 'PAUSED_BUDGET';
          row.state = 'failed';
        } else if (result.outcome === 'deferred') {
          stopped ??= 'PAUSED_QUOTA';
          row.state = 'failed';
          resumeAt = result.resumeAt;
        } else if (result.outcome === 'failed') {
          if (completed.crashed || !completed.result)
            await step.run(`fail-invocation-${completed.stageKey}`, () =>
              db
                .update(stageExecution)
                .set({ state: 'failed', failure: { reason: result.reason }, endedAt: sql`now()` })
                .where(
                  and(
                    eq(stageExecution.id, row.id),
                    sql`exists (select 1 from ${run} where ${run.id} = ${runId} and ${run.executionEpoch} = ${settings.epoch} and ${run.state} in ('RUNNING','PAUSING'))`,
                  ),
                ),
            );
          failed = true;
          row.state = 'failed';
        } else row.state = 'cancelled';
      }
      if (stopped) {
        if (stopped === 'PAUSED_QUOTA' && resumeAt)
          await step.run('mark-paused-quota', () =>
            runState.pauseForQuota(runId, resumeAt!, settings.epoch),
          );
        if (stopped === 'PAUSED_BUDGET')
          await step.run('mark-paused-budget', () =>
            runState.transition(runId, stopped!, settings.epoch),
          );
        await notify(stopped === 'PAUSED_BUDGET' ? 'paused_budget' : 'paused_quota');
        return { state: stopped };
      }
      if (failed) {
        await step.run('mark-failed', () => runState.transition(runId, 'FAILED', settings.epoch));
        await notify('failed');
        return { state: 'FAILED' as const };
      }
      if (approval || input || rows.some((r) => r.openWait)) {
        const state = await step.run('mark-paused-waiting', async () => {
          const next = await pausedState(input ? 'PAUSED_INPUT' : 'PAUSED_APPROVAL');
          await runState.transition(runId, next, settings.epoch);
          return next;
        });
        if (approval || input) await notify(approval ? 'awaiting_approval' : 'awaiting_input');
        return { state };
      }
      if (!planWave(rows).allDone) {
        await step.run('mark-idle', () => runState.transition(runId, 'IDLE', settings.epoch));
        return { state: 'IDLE' as const };
      }

      await step.run('mark-completed', () =>
        runState.transition(runId, 'COMPLETED', settings.epoch),
      );
      await step.run('clear-cursor', () => runState.setCursor(runId, null, settings.epoch));

      if (derivedFrames) {
        await step
          .run('extract-poster', async () => {
            const final = await findFinalVideo(db, runId);
            if (!final) return { extracted: false as const };
            const [artifactRow] = await db
              .select()
              .from(artifact)
              .where(eq(artifact.id, final.artifactId))
              .limit(1);
            if (!artifactRow) return { extracted: false as const };
            await derivedFrames.extract(artifactRow, 'poster');
            return { extracted: true as const };
          })
          .catch((err: unknown) => {
            // A poster is a thumbnail nicety, not part of the run's actual
            // output — never fail an otherwise-completed run over it.
            logger.warn({ runId, err }, 'extract-poster step failed; run stays COMPLETED');
          });
      }

      await notify('completed');

      return { state: 'COMPLETED' as const };
    },
  );
}
