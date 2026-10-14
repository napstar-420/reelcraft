import type { Inngest } from 'inngest';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { StageDef, stageDependencies } from '@reelcraft/shared';
import type { Db } from '../../db/drizzle.provider';
import { artifact, blueprintVersion, run, stageExecution, stageItem } from '../../db/schema/index';
import type { RunStateService } from '../run-state.service';
import { isStageEnabled } from '../enabled-when';
import { buildStageExecuteFunction } from './stage-execute.fn';
import { worstOutcome } from './stage-outcome';
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
    else if (depsOf(row, i).every(isDone)) ready.push(row);
  });
  return { ready, waiting, allDone: rows.every((row) => isDone(row.stageKey)) };
}

/**
 * §13.4/§13.5 — one Run at a time (`concurrency` keyed by runId), cancels on
 * `run/cancelled` for the same runId. Walks stage_execution rows created at
 * run start in waves: every stage whose dependencies have settled starts
 * together (`planWave`). With no `dependsOn` a stage waits for the previous
 * one, so a chain runs one stage at a time exactly as before (§16.1).
 * `stage_execution` carries no ordinal column, so the graph is loaded and the
 * rows sorted in memory rather than adding a migration for a run-start-time
 * property.
 *
 * §12.4 — triggers on `run/resumed` as well as `run/started`: the existing
 * unconditional `mark-running` step below is what actually flips a
 * `PAUSED_BUDGET` run back to `RUNNING` on a resumed invocation, so no
 * separate "un-pause" step is needed. The loop's `state === 'passed'` skip
 * re-enters at whichever stage_execution isn't done yet — including the one
 * that was `budget_blocked`, via a fresh `beginAttempt` inside
 * `stage.execute` (a new attempt row, not a resumption of the old one).
 *
 * phase 7 chunk 5 — item-level invalidation can leave an iterating stage's
 * `stage_execution.state` at `'passed'` while only some of its `stage_item`
 * rows are `'stale'` (retrying one item never regresses the whole stage —
 * see `InvalidationService.apply()`). The bare `state === 'passed'` skip
 * would otherwise never re-`step.invoke` that stage again, stranding the
 * stale items forever, so the skip also checks `needsItemWork` (computed in
 * `load-stage-executions` from `stage_item` rows still not `'passed'`).
 * `stage.execute`'s own outer per-item loop (Chunk 4) already re-checks
 * each item's state and only re-invokes `stage.execute.item` for the ones
 * that aren't `'passed'`, so no other change is needed once this function
 * actually re-enters the stage.
 */
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
      cancelOn: [{ event: 'run/cancelled', match: 'data.runId' }],
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
        await step.run('mark-running', () => runState.transition(runId, 'RUNNING'));
      }

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
          enabled: isStageEnabled(enabledWhenByKey.get(r.stageKey), inputs),
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

      // Mutable copy: each wave settles stages, and the next wave plans from that.
      const rows = executions.map((execution) => ({ ...execution }));

      for (;;) {
        const { ready, waiting, allDone } = planWave(rows);
        if (allDone) break;

        if (ready.length === 0) {
          if (waiting.length === 0) {
            throw new Error(`run.orchestrate: run ${runId} has stages left but none can start`);
          }
          // Every stage left is waiting on a person: park again, quietly — they
          // were told when each wait opened.
          const state = await step.run('mark-paused-waiting', async () => {
            const next = await pausedState('PAUSED_APPROVAL');
            await runState.transition(runId, next);
            return next;
          });
          return { state };
        }

        // §16 — "Enabled when" didn't match this run's input: skip the stage.
        const disabled = ready.filter((execution) => !execution.enabled);
        if (disabled.length > 0) {
          for (const execution of disabled) {
            await step.run(`skip-disabled-${execution.stageKey}`, () =>
              runState.skipStage(runId, execution.id, execution.stageKey),
            );
            execution.state = 'skipped';
          }
          continue;
        }

        const first = ready[0]!;
        // §12.4 manual pause — checked before starting the next stage, not
        // by killing the durable function (that's cancel's job via
        // `cancelOn`). Leaves the cursor untouched so a later `run/resumed`
        // naturally re-enters at this same stage.
        const runnableState = await step.run(`check-runnable-${first.stageKey}`, () =>
          runState.getState(runId),
        );
        if (runnableState !== 'RUNNING') {
          logger.info(
            { runId, stageKey: first.stageKey, state: runnableState },
            'run orchestration stopped: run not running',
          );
          return { state: runnableState ?? ('CANCELLED' as const) };
        }

        await step.run(`set-cursor-${first.stageKey}`, () =>
          runState.setCursor(runId, first.stageKey),
        );

        // Independent stages run together. The wave drains before anything is
        // decided, so a stage that fails or waits never strands its siblings.
        const settled = await Promise.allSettled(
          ready.map((execution) =>
            step.invoke(`invoke-stage-${execution.stageKey}`, {
              function: stageExecuteFn,
              data: { runId, stageExecutionId: execution.id, stageKey: execution.stageKey },
            }),
          ),
        );
        const crashed = settled.find((entry) => entry.status === 'rejected');
        if (crashed?.status === 'rejected') throw crashed.reason;
        const results = settled.flatMap((entry, i) =>
          entry.status === 'fulfilled' ? [{ ...entry.value, stageKey: ready[i]!.stageKey }] : [],
        );
        for (const result of results) {
          if (result.outcome !== 'passed') continue;
          const row = rows.find((candidate) => candidate.stageKey === result.stageKey)!;
          row.state = 'passed';
          row.needsItemWork = false;
        }

        const result = worstOutcome(results);
        if (!result) continue;

        if (result.outcome === 'budget_blocked') {
          // §11.5 — never silently resumes, never silently dies. Cursor is
          // deliberately left pointing at this stage (set just above) so a
          // resumed invocation naturally re-enters here.
          await step.run('mark-paused-budget', () => runState.transition(runId, 'PAUSED_BUDGET'));
          await notify('paused_budget');
          return { state: 'PAUSED_BUDGET' as const };
        }

        if (result.outcome === 'deferred') {
          // The provider is out of quota (e.g. every Flow account's credits).
          // The pause carries its own timed wakeup, so the run resumes by itself.
          const { resumeAt } = result;
          const paused = await step.run('mark-paused-quota', () =>
            runState.pauseForQuota(runId, resumeAt),
          );
          // False when the run was no longer RUNNING (cancelled or paused by hand).
          if (paused) await notify('paused_quota');
          return { state: 'PAUSED_QUOTA' as const };
        }

        if (result.outcome === 'run_not_running') {
          // The run stopped being RUNNING while this stage's attempt was
          // in flight (manual pause or cancel raced it). Re-read the actual
          // state rather than assuming CANCELLED — a paused run should be
          // reported (and left) as PAUSED_MANUAL, not mislabeled.
          const stateAfter = await step.run(`state-after-${result.stageKey}`, () =>
            runState.getState(runId),
          );
          logger.info(
            { runId, stageKey: result.stageKey, state: stateAfter },
            'run orchestration stopped: run left running mid-stage',
          );
          return { state: stateAfter ?? ('CANCELLED' as const) };
        }

        if (result.outcome === 'approval_required' || result.outcome === 'input_required') {
          const approval = result.outcome === 'approval_required';
          const legacy = approval ? 'PAUSED_APPROVAL' : 'PAUSED_INPUT';
          const state = await step.run(
            approval ? 'mark-paused-approval' : 'mark-paused-input',
            async () => {
              const next = await pausedState(legacy);
              await runState.transition(runId, next);
              return next;
            },
          );
          await notify(approval ? 'awaiting_approval' : 'awaiting_input');
          return { state: state ?? legacy };
        }

        await step.run('mark-failed', () => runState.transition(runId, 'FAILED'));
        await notify('failed');
        return { state: 'FAILED' as const };
      }

      await step.run('mark-completed', () => runState.transition(runId, 'COMPLETED'));
      await step.run('clear-cursor', () => runState.setCursor(runId, null));

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
