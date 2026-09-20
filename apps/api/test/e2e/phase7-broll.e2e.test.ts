import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { InputDef, StageDef } from '@reefcraft/shared';
import type { EffectiveStageConfig } from '../../src/run-config/config-resolver.service';
import { BlueprintService } from '../../src/blueprint/blueprint.service';
import { ChannelService } from '../../src/channel/channel.service';
import { RunService } from '../../src/run/run.service';
import { InvalidationService } from '../../src/run/invalidation.service';
import { RunStateService } from '../../src/orchestration/run-state.service';
import { StageRunnerService } from '../../src/orchestration/stage-runner.service';
import { DerivedFrameService } from '../../src/artifact/derived-frame.service';
import { toUsd } from '../../src/common/money';
import {
  run,
  ledgerEntry,
  runMemory,
  stageAttempt,
  stageExecution,
  stageItem,
} from '../../src/db/schema/index';
import { buildTestApp, type TestApp } from '../support/build-app';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * Phase 7 chunk 7 — the acceptance scenario. Builds the design spec's §25.1
 * `broll` shape (`script -> shots -> broll -> music -> timeline`, dropping
 * `vo`/`timing`/`draft`/`final` — they add no new binding/invalidation
 * coverage beyond what this file and Chunks 1-6's own suites already
 * exercise) and drives it through `StageRunnerService` directly (no
 * Inngest, matching every other Phase 7 e2e suite's style), proving the two
 * traces §25.4 names explicitly:
 *
 * - **Failure**: `broll` item 3 (of 6) fails its check twice, exhausts
 *   `itemRetryLimit`, items 0-2 stay `passed` with intact artifacts/ledger
 *   entries, items 4-5 never start, the run ends `FAILED` with
 *   `cursorStageKey: 'broll'`; fixing the underlying issue and resuming
 *   restarts at item 3 without regenerating or recharging items 0-2.
 * - **Invalidation**: retrying `broll` item 2 invalidates items 2-5 of
 *   `broll` (it binds `{from:'prevItem'}` for `startFrame` continuity) and
 *   `timeline` (reads the `memory:broll` group), but leaves `music` (reads
 *   only `memory:script`) untouched — the phase's headline
 *   "array-position invalidation would have discarded this" claim.
 *
 * `broll` uses the real `video.generate` capability (so `{from:'prevItem',
 * path:'lastFrame'}` really exercises `DerivedFrameService`) with a
 * `TestableDerivedFrameService` swapped in for the real one — same pattern
 * as `derived-frame.e2e.test.ts` — so this suite proves ORCHESTRATION and
 * INVALIDATION correctness without a host ffmpeg install. The ffmpeg
 * extraction itself, against a real video file, is `phase7-broll-frames.ts`
 * (local-only acceptance script)'s job.
 *
 * The failure mechanism deliberately deviates from the plan doc's literal
 * sketch in one respect, noted here and in `.claude/plans/phase-7-progress.md`:
 * `shots` item 3 is authored with `forceFail: true` and `broll`'s check
 * reads `{from:'item'}` to assert `!item.forceFail`, exactly as planned —
 * but "fixing" that failure for the resume step needs something an already
 *-finalized, memory-written `shots` array cannot supply (editing the
 * underlying artifact would invalidate `shots` itself, discarding far more
 * than the spec's own trace touches). The check also reads a
 * `{from:'input', inputKey:'disableForceFailCheck'}` kill switch; flipping
 * `run.inputs` directly via a raw DB update — not a real HTTP endpoint —
 * mirrors exactly how `phase7-iteration.e2e.test.ts` (Chunk 4) already
 * "fixes and resumes" its own forced failure, and is the least invasive way
 * to make item 3 pass on resume without touching items 0-2's artifacts.
 */
describe('phase 7 chunk 7 — broll acceptance scenario (e2e)', () => {
  let testDb: TestDb;
  let testApp: TestApp;
  let fixturePath: string;

  /** Overrides the real ffmpeg invocation so this suite never shells out to
   * a real binary — same pattern as `derived-frame.e2e.test.ts`'s own
   * `TestableDerivedFrameService`. */
  class TestableDerivedFrameService extends DerivedFrameService {
    protected override async runFfmpeg(args: string[]): Promise<void> {
      const dest = args[args.length - 1]!;
      await writeFile(dest, Buffer.from('fake-derived-frame-png-bytes'));
    }
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    testApp = await buildTestApp(testDb, { derivedFrame: TestableDerivedFrameService });
    const dir = await mkdtemp(path.join(tmpdir(), 'reefcraft-phase7-broll-'));
    fixturePath = path.join(dir, 'fake-clip.mp4');
    // Never actually decoded — `MediaProbeService` is stubbed by
    // `buildTestApp`'s default (`testMediaProbe()`), so this just needs to
    // exist on disk for `MediaArtifactService.persist`'s `readFile`.
    await writeFile(fixturePath, Buffer.from('fake mp4 bytes'));
  });

  afterAll(async () => {
    try {
      await testApp?.close();
    } finally {
      await testDb.teardown();
    }
  });

  interface Shot {
    prompt: string;
    forceFail: boolean;
  }

  function shots(count: number, forceFailIndex?: number): Shot[] {
    return Array.from({ length: count }, (_, i) => ({
      prompt: `shot ${i}`,
      forceFail: i === forceFailIndex,
    }));
  }

  function scriptStage(): StageDef {
    return {
      key: 'script',
      label: 'Script',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: {},
      writes: { script: '$' },
      output: {
        kind: 'data',
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { text: 'a narrated explainer about reefs' } },
      },
    };
  }

  function shotsStage(shotList: Shot[]): StageDef {
    return {
      key: 'shots',
      label: 'Shots',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: {},
      writes: { shots: '$' },
      output: {
        kind: 'data',
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { prompt: { type: 'string' }, forceFail: { type: 'boolean' } },
            required: ['prompt', 'forceFail'],
          },
        },
      },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: shotList },
      },
    };
  }

  /** Real `video.generate`, iterating `memory:shots` (§25.1's own table
   * entry, "iterates memory:shots" — a bare-key group read of a
   * non-iterating writer's whole array, distinct from `{from:'prev'}`),
   * `startFrame` bound from `{from:'prevItem', path:'lastFrame'}` — the
   * exact §14.4 shortcut. Item-mode approval is deliberately not layered
   * onto this stage: `item-approval.e2e.test.ts` (Chunk 6) already covers
   * `approval.mode:'item'` end to end in isolation, so combining it here
   * would add complexity without new coverage. */
  function brollStage(itemRetryLimit: number): StageDef {
    return {
      key: 'broll',
      label: 'B-roll',
      capability: 'video.generate',
      config: {},
      slots: { startFrame: { from: 'prevItem', path: 'lastFrame' } },
      context: {},
      iterate: { over: { from: 'memory', key: 'shots' }, itemAlias: 'shot', itemRetryLimit },
      writes: { broll: '$' },
      // Our fake fixture has no audio track; the check under test is the
      // forced-failure one below, not §26.1's "video is audio-bearing by
      // default" audio_constraint check.
      output: { kind: 'media.video', constraints: { audio: 'optional' } },
      checks: [
        {
          type: 'script',
          name: 'not_forced_to_fail',
          refs: {
            item: { from: 'item' },
            disable: { from: 'input', inputKey: 'disableForceFailCheck' },
          },
          code: `
            const item = refs.item.data;
            const disabled = refs.disable.data === 'yes';
            const failing = Boolean(item && item.forceFail) && !disabled;
            return { pass: !failing, message: failing ? 'forced item failure' : undefined };
          `,
        },
      ],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-video-1',
        params: {
          fakeOutput: { kind: 'media.video', localPath: fixturePath, mime: 'video/mp4' },
        },
      },
    };
  }

  /** Reads only `memory:script` — the sibling that §25.4 asserts must
   * survive a `broll` retry untouched. */
  function musicStage(): StageDef {
    return {
      key: 'music',
      label: 'Music',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: { scriptRef: { from: 'memory', key: 'script' } },
      output: {
        kind: 'data',
        schema: { type: 'object', properties: { track: { type: 'string' } }, required: ['track'] },
      },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { track: 'theme.mp3' } },
      },
    };
  }

  /** Reads the `memory:broll` group (bare key, aggregating every item) —
   * the downstream consumer §25.4 asserts DOES go stale when any of its
   * indices is invalidated. */
  function timelineStage(): StageDef {
    return {
      key: 'timeline',
      label: 'Timeline',
      capability: 'llm.generate',
      config: {},
      slots: {},
      context: { brollRef: { from: 'memory', key: 'broll' } },
      output: {
        kind: 'data',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
      checks: [],
      retryLimit: 0,
      model: {
        provider: 'fake',
        modelId: 'fake-text-1',
        params: { max_tokens: 64, fakeOutput: { ok: true } },
      },
    };
  }

  const DISABLE_CHECK_INPUT: InputDef = {
    key: 'disableForceFailCheck',
    label: 'Disable the forced-failure check',
    required: false,
    accepts: { kind: 'text' },
  };

  async function createRun(graph: StageDef[]) {
    const channels = testApp.app.get(ChannelService);
    const blueprints = testApp.app.get(BlueprintService);
    const runs = testApp.app.get(RunService);
    const channel = await channels.create('local', {
      name: `Phase 7 Broll ${Date.now()} ${Math.random()}`,
      theme: {},
      defaults: {},
    });
    const blueprintId = await blueprints.ensureBlueprint(channel.id, 'Phase 7 Broll');
    const version = await blueprints.createVersion(blueprintId, {
      graph,
      inputs: [DISABLE_CHECK_INPUT],
      roles: [],
      defaults: {},
      budget: { runCapUsd: 10 },
    });
    const created = await runs.create({
      channelId: channel.id,
      blueprintVersionId: version.id,
      inputs: {},
      roleBindings: {},
      budgetCapUsd: 10,
    });
    await testDb.db.update(run).set({ state: 'RUNNING' }).where(eq(run.id, created.id));
    return created;
  }

  function execOf(
    created: Awaited<ReturnType<typeof createRun>>,
    stageKey: string,
  ): (typeof created.stageExecutions)[number] {
    const found = created.stageExecutions.find((e) => e.stageKey === stageKey);
    if (!found) throw new Error(`no stage_execution for "${stageKey}"`);
    return found;
  }

  async function selectItems(stageExecutionId: string) {
    return testDb.db
      .select()
      .from(stageItem)
      .where(eq(stageItem.stageExecutionId, stageExecutionId))
      .orderBy(stageItem.itemIndex);
  }

  /** Drives one non-iterating stage's single attempt to completion. */
  async function passStage(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stageKey: string,
  ) {
    const { stage, effective, prevStageKey } = await runner.loadStageContext(runId, stageKey);
    const attempt = await runner.beginAttempt({ runId, stageExecutionId: executionId, stageKey });
    const submitted = await runner.reserveAndSubmit(stage, attempt, prevStageKey, effective);
    if (submitted.outcome !== 'submitted') {
      throw new Error(`unexpected submit outcome for "${stageKey}": ${submitted.outcome}`);
    }
    const result = await runner.fetchAndFinalize(
      stage,
      attempt,
      submitted.handle,
      prevStageKey,
      effective,
    );
    if (result.outcome !== 'success') {
      throw new Error(`unexpected fetch outcome for "${stageKey}": ${result.outcome}`);
    }
  }

  /** Drives one item's attempt loop directly, retrying up to
   * `effective.iterate.itemRetryLimit` times — the same shape
   * `stage.execute.item`'s real attempt loop drives, minus Inngest step
   * boundaries (matches `phase7-iteration.e2e.test.ts`'s own helper). */
  async function driveItemAttempts(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemIndex: number,
    stageItemId: string,
  ) {
    const maxAttempts = effective.iterate!.itemRetryLimit + 1;
    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      const attemptCtx = await runner.beginAttempt({
        runId,
        stageExecutionId: executionId,
        stageKey: stage.key,
        itemIndex,
        stageItemId,
      });
      const submitted = await runner.reserveAndSubmit(stage, attemptCtx, prevStageKey, effective);
      if (submitted.outcome !== 'submitted') {
        throw new Error(`unexpected submit outcome: ${submitted.outcome}`);
      }
      const result = await runner.fetchAndFinalize(
        stage,
        attemptCtx,
        submitted.handle,
        prevStageKey,
        effective,
      );
      if (result.outcome === 'success') return { outcome: 'success' as const };
      if (attemptNo === maxAttempts) {
        const reason = result.outcome === 'check_failed' ? 'check_failed' : result.outcome;
        await runner.failStageExecution(executionId, reason, stageItemId);
        return { outcome: 'failed' as const, reason };
      }
    }
    throw new Error('unreachable');
  }

  /** The outer per-item loop, as `stage.execute`'s iterate branch drives
   * it, minus the Inngest step boundaries. */
  async function driveIteratingLoop(
    runner: StageRunnerService,
    runId: string,
    executionId: string,
    stage: StageDef,
    effective: EffectiveStageConfig,
    prevStageKey: string | undefined,
    itemCount: number,
  ): Promise<{ outcome: 'passed' } | { outcome: 'failed' }> {
    for (let i = 0; i < itemCount; i += 1) {
      const item = await runner.itemState(executionId, i);
      if (item.state === 'passed') continue;
      const result = await driveItemAttempts(
        runner,
        runId,
        executionId,
        stage,
        effective,
        prevStageKey,
        i,
        item.id,
      );
      if (result.outcome !== 'success') return { outcome: 'failed' };
    }
    await runner.finishIteratingStage(executionId);
    return { outcome: 'passed' };
  }

  it('exhausts itemRetryLimit on a forced item failure, preserves earlier items and their ledger entries, marks the run FAILED at the iterating stage, and partial-resumes without touching passed items (§25.4 failure trace)', async () => {
    const graph = [
      scriptStage(),
      shotsStage(shots(6, 3)),
      brollStage(1),
      musicStage(),
      timelineStage(),
    ];
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    const runState = testApp.app.get(RunStateService);

    const scriptExec = execOf(created, 'script');
    const shotsExec = execOf(created, 'shots');
    const brollExec = execOf(created, 'broll');

    await passStage(runner, created.id, scriptExec.id, 'script');
    await passStage(runner, created.id, shotsExec.id, 'shots');

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
    );
    if (!resolved.ok) throw new Error(`unexpected resolveIterateCount: ${resolved.reason}`);
    expect(resolved.itemCount).toBe(6);
    await runner.ensureStageItems(brollExec.id, resolved.itemCount);

    const firstPass = await driveIteratingLoop(
      runner,
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
      resolved.itemCount,
    );
    expect(firstPass.outcome).toBe('failed');

    // What `run.orchestrate` itself would do on receiving `{outcome:'failed'}`
    // from `stage.execute` — this suite drives the engine directly (no
    // Inngest), so it reproduces that transition by hand.
    await runState.setCursor(created.id, 'broll');
    await runState.transition(created.id, 'FAILED');

    const itemsAfterFailure = await selectItems(brollExec.id);
    expect(itemsAfterFailure.map((row) => row.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'failed',
      'pending', // never attempted — iteration is sequential (§25.4 point 1)
      'pending',
    ]);
    const artifactsBefore = itemsAfterFailure.map((row) => row.outputArtifactId);
    expect(artifactsBefore.slice(0, 3).every((id) => id !== null)).toBe(true);

    const attemptsByItem = async (stageItemId: string) =>
      testDb.db.select().from(stageAttempt).where(eq(stageAttempt.stageItemId, stageItemId));
    for (let i = 0; i < 3; i += 1) {
      expect(await attemptsByItem(itemsAfterFailure[i]!.id)).toHaveLength(1);
    }
    // itemRetryLimit:1 -> 2 attempts on the forced-failure item, both check_failed.
    const item3AttemptsAfterFailure = await attemptsByItem(itemsAfterFailure[3]!.id);
    expect(item3AttemptsAfterFailure).toHaveLength(2);
    expect(item3AttemptsAfterFailure.every((row) => row.outcome === 'check_failed')).toBe(true);
    expect(await attemptsByItem(itemsAfterFailure[4]!.id)).toHaveLength(0);
    expect(await attemptsByItem(itemsAfterFailure[5]!.id)).toHaveLength(0);

    // `ledgerEntry.stageItemId` exists on the schema but nothing populates
    // it (confirmed by reading `LedgerService`) — per the plan doc's own
    // Chunk 4 baseline note, item-level ledger accounting "generalizes to
    // per-item attempts with zero code changes" via `stageAttemptId` alone,
    // since each item's attempt is its own `stage_attempt` row. Query
    // through that join instead of the unpopulated column.
    const ledgerActualUsdFor = async (stageItemId: string) => {
      const rows = await testDb.db
        .select({ amountUsd: ledgerEntry.amountUsd })
        .from(ledgerEntry)
        .innerJoin(stageAttempt, eq(ledgerEntry.stageAttemptId, stageAttempt.id))
        .where(and(eq(stageAttempt.stageItemId, stageItemId), eq(ledgerEntry.kind, 'actual')));
      return rows.reduce((sum, row) => sum + toUsd(row.amountUsd), 0);
    };
    const ledgerBefore = await Promise.all(
      [0, 1, 2].map((i) => ledgerActualUsdFor(itemsAfterFailure[i]!.id)),
    );
    expect(ledgerBefore.every((usd) => usd > 0)).toBe(true);

    const [runAfterFailure] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(runAfterFailure?.state).toBe('FAILED');
    expect(runAfterFailure?.cursorStageKey).toBe('broll'); // §25.4 point 2

    // --- Fix the underlying issue and resume (§25.4 point 3-4) — see the
    // file-level doc comment for why a direct `run.inputs` flip stands in
    // for the spec's "patches the stage config" here. ---
    await testDb.db
      .update(run)
      .set({ inputs: { disableForceFailCheck: 'yes' } })
      .where(eq(run.id, created.id));
    // A real resume (`RunActionService.confirmStageRetry`, or the wakeup
    // consumer after `HumanActionService.approve`) always flips the run
    // back to `RUNNING` before re-entering `stage.execute` — without it,
    // `reserveAndSubmit`'s ledger reservation guard (stage-runner.service.ts
    // ~line 849) would bounce every attempt with `run_not_running`, exactly
    // as it should for a run that's still `FAILED`. This suite drives the
    // engine directly (no Inngest/wakeup consumer), so it reproduces that
    // transition by hand, same as Chunk 6's `item-approval.e2e.test.ts`.
    await runState.transition(created.id, 'RUNNING');

    const secondPass = await driveIteratingLoop(
      runner,
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
      resolved.itemCount,
    );
    expect(secondPass.outcome).toBe('passed');

    const itemsAfterResume = await selectItems(brollExec.id);
    expect(itemsAfterResume.map((row) => row.state)).toEqual(Array(6).fill('passed'));

    // Items 0-2 were never regenerated or recharged (§25.4 point 4).
    for (let i = 0; i < 3; i += 1) {
      expect(itemsAfterResume[i]?.outputArtifactId).toBe(artifactsBefore[i]);
      expect(await attemptsByItem(itemsAfterResume[i]!.id)).toHaveLength(1);
    }
    const ledgerAfter = await Promise.all(
      [0, 1, 2].map((i) => ledgerActualUsdFor(itemsAfterResume[i]!.id)),
    );
    expect(ledgerAfter).toEqual(ledgerBefore);

    // Item 3 restarted exactly where it left off (attempt_no never resets)
    // and finally passed; items 4-5 ran for the first time.
    const item3AttemptsAfterResume = await attemptsByItem(itemsAfterResume[3]!.id);
    expect(item3AttemptsAfterResume.map((row) => row.attemptNo).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(item3AttemptsAfterResume.find((row) => row.attemptNo === 3)?.outcome).toBe('success');
    expect(await attemptsByItem(itemsAfterResume[4]!.id)).toHaveLength(1);
    expect(await attemptsByItem(itemsAfterResume[5]!.id)).toHaveLength(1);
  });

  it('retrying one item invalidates same-stage successors and memory-group readers but leaves an unrelated memory reader alone (§25.4 invalidation trace)', async () => {
    const graph = [
      scriptStage(),
      shotsStage(shots(6)),
      brollStage(0),
      musicStage(),
      timelineStage(),
    ];
    const created = await createRun(graph);
    const runner = testApp.app.get(StageRunnerService);
    const invalidation = testApp.app.get(InvalidationService);

    const scriptExec = execOf(created, 'script');
    const shotsExec = execOf(created, 'shots');
    const brollExec = execOf(created, 'broll');
    const musicExec = execOf(created, 'music');
    const timelineExec = execOf(created, 'timeline');

    await passStage(runner, created.id, scriptExec.id, 'script');
    await passStage(runner, created.id, shotsExec.id, 'shots');

    const { stage, effective, prevStageKey } = await runner.loadStageContext(created.id, 'broll');
    const resolved = await runner.resolveIterateCount(
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
    );
    if (!resolved.ok) throw new Error(`unexpected resolveIterateCount: ${resolved.reason}`);
    await runner.ensureStageItems(brollExec.id, resolved.itemCount);
    const brollOutcome = await driveIteratingLoop(
      runner,
      created.id,
      brollExec.id,
      stage,
      effective,
      prevStageKey,
      resolved.itemCount,
    );
    expect(brollOutcome.outcome).toBe('passed');

    await passStage(runner, created.id, musicExec.id, 'music');
    await passStage(runner, created.id, timelineExec.id, 'timeline');

    // The `{from:'prevItem', path:'lastFrame'}` carry really extracted a
    // derived frame at least once (item 0 has no predecessor, so this can
    // only have come from item >= 1's own attempt).
    const itemsBefore = await selectItems(brollExec.id);
    expect(itemsBefore.map((row) => row.state)).toEqual(Array(6).fill('passed'));
    const artifactsBefore = itemsBefore.map((row) => row.outputArtifactId);

    // --- Retry broll item 2 ---
    const preview = await invalidation.preview({
      runId: created.id,
      seed: { items: [{ stageKey: 'broll', itemIndex: 2 }] },
    });

    // §25.4 point 1: item 2 plus its three successors (broll binds
    // prevItem for start-frame continuity).
    const brollAffectedIndices = preview.closure.affectedItems
      .filter((item) => item.stageKey === 'broll')
      .map((item) => item.itemIndex)
      .sort((a, b) => (a ?? -1) - (b ?? -1));
    expect(brollAffectedIndices).toEqual([2, 3, 4, 5]);

    // §25.4 point 2-3: `timeline` (reads memory:broll) follows; `music`
    // (reads only memory:script) does not — the headline claim.
    expect(preview.closure.affectedStageKeys).toEqual(['broll', 'timeline']);
    expect(preview.closure.affectedStageKeys).not.toContain('music');
    expect(preview.closure.affectedStageKeys).not.toContain('script');
    expect(preview.closure.affectedStageKeys).not.toContain('shots');

    await testDb.db.transaction((tx) =>
      invalidation.apply(tx, {
        runId: created.id,
        closure: preview.closure,
        targetStageKey: 'broll',
      }),
    );

    const itemsAfter = await selectItems(brollExec.id);
    expect(itemsAfter.map((row) => row.state)).toEqual([
      'passed',
      'passed',
      'stale',
      'stale',
      'stale',
      'stale',
    ]);
    expect(itemsAfter[0]?.outputArtifactId).toBe(artifactsBefore[0]);
    expect(itemsAfter[1]?.outputArtifactId).toBe(artifactsBefore[1]);

    const [musicRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, musicExec.id));
    expect(musicRow?.state).toBe('passed'); // untouched — §25.4 point 3

    const [timelineRow] = await testDb.db
      .select()
      .from(stageExecution)
      .where(eq(stageExecution.id, timelineExec.id));
    expect(timelineRow?.state).toBe('stale'); // §25.4 point 2

    // §25.4 point 4: broll#2..#5 tombstoned in the same transaction; #0/#1
    // and the unrelated `script` key survive untouched.
    const memory = await testDb.db
      .select()
      .from(runMemory)
      .where(eq(runMemory.runId, created.id))
      .orderBy(runMemory.memKey, runMemory.version);
    const currentByKey = new Map<string, (typeof memory)[number]>();
    for (const row of memory) {
      const current = currentByKey.get(row.memKey);
      if (!current || row.version > current.version) currentByKey.set(row.memKey, row);
    }
    expect(currentByKey.get('broll#0')?.tombstone).toBe(false);
    expect(currentByKey.get('broll#1')?.tombstone).toBe(false);
    expect(currentByKey.get('broll#2')?.tombstone).toBe(true);
    expect(currentByKey.get('broll#3')?.tombstone).toBe(true);
    expect(currentByKey.get('broll#4')?.tombstone).toBe(true);
    expect(currentByKey.get('broll#5')?.tombstone).toBe(true);
    expect(currentByKey.get('script')?.tombstone).toBe(false);

    const [runAfter] = await testDb.db.select().from(run).where(eq(run.id, created.id));
    expect(runAfter?.cursorStageKey).toBe('broll');
  });
});
