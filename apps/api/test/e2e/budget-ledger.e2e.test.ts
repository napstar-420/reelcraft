import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LedgerService } from '../../src/budget/ledger.service';
import { ulid } from '../../src/common/ulid';
import { toUsd, fromUsd } from '../../src/common/money';
import {
  blueprint,
  blueprintVersion,
  channel,
  ledgerEntry,
  run,
  stageAttempt,
  stageExecution,
} from '../../src/db/schema/index';
import { createTestDb, type TestDb } from '../support/test-db';

/**
 * §11 — direct `LedgerService` coverage, no Inngest/capability wiring
 * involved (mirrors `semantic-retry.e2e.test.ts`'s direct-service style).
 * `run`/`stage_execution`/`stage_attempt` rows are seeded directly since
 * `ledger_entry.stage_attempt_id` is a real FK — this is the concurrency-
 * and-algorithm-critical surface of phase 3 chunk 1.
 */
describe('LedgerService (e2e)', () => {
  let testDb: TestDb;
  let ledger: LedgerService;
  let channelId: string;
  let versionId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    ledger = new LedgerService(testDb.db);

    channelId = ulid();
    await testDb.db
      .insert(channel)
      .values({ id: channelId, ownerId: 'local', name: 'Ledger Test Channel' });

    const blueprintId = ulid();
    await testDb.db
      .insert(blueprint)
      .values({ id: blueprintId, channelId, name: 'Ledger Test Blueprint' });

    versionId = ulid();
    await testDb.db.insert(blueprintVersion).values({
      id: versionId,
      blueprintId,
      version: 1,
      graph: [],
      defaults: {},
      budget: { runCapUsd: 10 },
      validation: [],
      runnable: true,
    });
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  async function seedRun(budgetCapUsd: number): Promise<string> {
    const runId = ulid();
    await testDb.db.insert(run).values({
      id: runId,
      channelId,
      blueprintVersionId: versionId,
      state: 'RUNNING',
      inputs: {},
      resolvedConfig: {},
      budgetCapUsd: fromUsd(budgetCapUsd),
    });
    return runId;
  }

  async function seedAttempt(runId: string, stageKey: string): Promise<string> {
    const stageExecutionId = ulid();
    // `stage_execution` has a (runId, stageKey) unique index, but several
    // tests below seed multiple attempts "against the same stage" for one
    // run — what the ledger actually keys stage-scope spend on is the
    // `stageKey` string passed to `reserve`/`settle*` calls directly, not
    // this row's own `stage_key` column, so giving each attempt's backing
    // `stage_execution` a unique key here is harmless and sidesteps the
    // constraint.
    await testDb.db.insert(stageExecution).values({
      id: stageExecutionId,
      runId,
      stageKey: `${stageKey}-${stageExecutionId}`,
      state: 'pending',
    });
    const stageAttemptId = ulid();
    await testDb.db.insert(stageAttempt).values({
      id: stageAttemptId,
      stageExecutionId,
      attemptNo: 1,
      outcome: 'success',
      resolvedInputs: {},
      phase: 'created',
      actor: 'engine',
    });
    return stageAttemptId;
  }

  async function runRow(runId: string) {
    const [row] = await testDb.db.select().from(run).where(eq(run.id, runId)).limit(1);
    if (!row) throw new Error(`run ${runId} not found`);
    return row;
  }

  async function reserveOrThrow(params: {
    runId: string;
    stageAttemptId: string;
    stageKey: string;
    ceilingUsd: number;
    stageCapUsd?: number;
  }): Promise<string> {
    const result = await ledger.reserve({
      runId: params.runId,
      stageKey: params.stageKey,
      stageAttemptId: params.stageAttemptId,
      category: 'stage_output',
      ceilingUsd: params.ceilingUsd,
      stageCapUsd: params.stageCapUsd,
      preSubmitTtlSec: 600,
    });
    if (!result.ok) throw new Error(`expected reserve to succeed, got "${result.reason}"`);
    return result.reservationId;
  }

  describe('reserve', () => {
    it('succeeds under the run cap, increments reservedUsd, writes one reservation row', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');

      const result = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        category: 'stage_output',
        ceilingUsd: 3,
        preSubmitTtlSec: 600,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.id, result.reservationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('reservation');
      expect(toUsd(rows[0]!.amountUsd)).toBe(3);
      expect(rows[0]?.expiresAt).not.toBeNull();

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(3);
    });

    it('rejects when the ceiling exceeds run availability, writing nothing', async () => {
      const runId = await seedRun(2);
      const stageAttemptId = await seedAttempt(runId, 'outline');

      const result = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        category: 'stage_output',
        ceilingUsd: 3,
        preSubmitTtlSec: 600,
      });

      expect(result).toEqual({ ok: false, reason: 'run_cap_exceeded' });
      const rows = await testDb.db.select().from(ledgerEntry).where(eq(ledgerEntry.runId, runId));
      expect(rows).toHaveLength(0);
      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(0);
    });

    it('rejects on a stage cap even when the run cap has room', async () => {
      const runId = await seedRun(10);
      const a1 = await seedAttempt(runId, 'outline');
      await reserveOrThrow({
        runId,
        stageAttemptId: a1,
        stageKey: 'outline',
        ceilingUsd: 2,
        stageCapUsd: 3,
      });

      const a2 = await seedAttempt(runId, 'outline');
      const second = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId: a2,
        category: 'stage_output',
        ceilingUsd: 2,
        stageCapUsd: 3,
        preSubmitTtlSec: 600,
      });

      expect(second).toEqual({ ok: false, reason: 'stage_cap_exceeded' });
      // The run cap alone would have allowed this — proves the rejection is
      // really coming from the stage-scope check, not the run-scope one.
      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(2);
    });

    it('a settled reservation no longer counts toward the stage cap', async () => {
      const runId = await seedRun(10);
      const a1 = await seedAttempt(runId, 'outline');
      const r1 = await reserveOrThrow({
        runId,
        stageAttemptId: a1,
        stageKey: 'outline',
        ceilingUsd: 2,
        stageCapUsd: 3,
      });
      await ledger.settleRelease({
        runId,
        stageKey: 'outline',
        stageAttemptId: a1,
        reservationId: r1,
      });

      const a2 = await seedAttempt(runId, 'outline');
      const second = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId: a2,
        category: 'stage_output',
        ceilingUsd: 2,
        stageCapUsd: 3,
        preSubmitTtlSec: 600,
      });

      expect(second.ok).toBe(true);
    });

    it('replaying the same stageAttemptId returns the same reservationId and increments reservedUsd only once', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');

      const first = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        category: 'stage_output',
        ceilingUsd: 3,
        preSubmitTtlSec: 600,
      });
      const second = await ledger.reserve({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        category: 'stage_output',
        ceilingUsd: 3,
        preSubmitTtlSec: 600,
      });

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error('unreachable');
      expect(second.reservationId).toBe(first.reservationId);

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(3);
      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.stageAttemptId, stageAttemptId));
      expect(rows).toHaveLength(1);
    });
  });

  describe('settlement', () => {
    it('settleSuccess writes a confirmed actual at the true cost and a confirmed release of the full ceiling', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');
      const reservationId = await reserveOrThrow({
        runId,
        stageAttemptId,
        stageKey: 'outline',
        ceilingUsd: 5,
      });

      await ledger.settleSuccess({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        reservationId,
        actualUsd: 2,
      });

      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.reservationId, reservationId));
      expect(rows).toHaveLength(2);
      const actual = rows.find((r) => r.kind === 'actual');
      const release = rows.find((r) => r.kind === 'release');
      expect(actual?.confirmed).toBe(true);
      expect(toUsd(actual!.amountUsd)).toBe(2);
      expect(release?.confirmed).toBe(true);
      expect(toUsd(release!.amountUsd)).toBe(5);

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(0);
      expect(toUsd(after.spentUsd)).toBe(2);
    });

    it('settleProvisional books the full ceiling as spend, unconfirmed', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');
      const reservationId = await reserveOrThrow({
        runId,
        stageAttemptId,
        stageKey: 'outline',
        ceilingUsd: 5,
      });

      await ledger.settleProvisional({ runId, stageKey: 'outline', stageAttemptId, reservationId });

      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.reservationId, reservationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('actual');
      expect(rows[0]?.confirmed).toBe(false);
      expect(toUsd(rows[0]!.amountUsd)).toBe(5);

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(0);
      expect(toUsd(after.spentUsd)).toBe(5);
    });

    it('settleRelease releases the ceiling without booking any spend', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');
      const reservationId = await reserveOrThrow({
        runId,
        stageAttemptId,
        stageKey: 'outline',
        ceilingUsd: 5,
      });

      await ledger.settleRelease({ runId, stageKey: 'outline', stageAttemptId, reservationId });

      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.reservationId, reservationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('release');
      expect(toUsd(rows[0]!.amountUsd)).toBe(5);

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(0);
      expect(toUsd(after.spentUsd)).toBe(0);
    });

    it('a second settle call on an already-settled reservation is a no-op, not a double adjustment', async () => {
      const runId = await seedRun(10);
      const stageAttemptId = await seedAttempt(runId, 'outline');
      const reservationId = await reserveOrThrow({
        runId,
        stageAttemptId,
        stageKey: 'outline',
        ceilingUsd: 5,
      });

      await ledger.settleSuccess({
        runId,
        stageKey: 'outline',
        stageAttemptId,
        reservationId,
        actualUsd: 2,
      });
      // Simulates budget.sweep (phase-3 chunk 3) racing a live settlement
      // for the SAME reservation — must not double-adjust reservedUsd/spentUsd.
      await ledger.settleRelease({ runId, stageKey: 'outline', stageAttemptId, reservationId });

      const rows = await testDb.db
        .select()
        .from(ledgerEntry)
        .where(eq(ledgerEntry.reservationId, reservationId));
      expect(rows).toHaveLength(2); // still just settleSuccess's own rows

      const after = await runRow(runId);
      expect(toUsd(after.reservedUsd)).toBe(0);
      expect(toUsd(after.spentUsd)).toBe(2);
    });
  });

  describe('qcSpentUsd', () => {
    it('sums confirmed qc-category actuals for one (run, stage), ignoring other stages/categories', async () => {
      const runId = await seedRun(10);
      await ledger.recordActual({ runId, stageKey: 'outline', category: 'qc', amountUsd: 1 });
      await ledger.recordActual({ runId, stageKey: 'outline', category: 'qc', amountUsd: 0.5 });
      await ledger.recordActual({
        runId,
        stageKey: 'outline',
        category: 'stage_output',
        amountUsd: 9,
      });
      await ledger.recordActual({ runId, stageKey: 'script', category: 'qc', amountUsd: 100 });

      expect(await ledger.qcSpentUsd(runId, 'outline')).toBe(1.5);
    });
  });

  describe('raiseBudget', () => {
    it('widens the cap under lock', async () => {
      const runId = await seedRun(10);

      const result = await ledger.raiseBudget({ runId, newCapUsd: 20 });

      expect(result).toEqual({ budgetCapUsd: 20 });
      const after = await runRow(runId);
      expect(toUsd(after.budgetCapUsd)).toBe(20);
    });

    it('throws when the new cap does not exceed the current one', async () => {
      const runId = await seedRun(10);
      await expect(ledger.raiseBudget({ runId, newCapUsd: 10 })).rejects.toThrow();
      await expect(ledger.raiseBudget({ runId, newCapUsd: 5 })).rejects.toThrow();
    });

    it('throws on a run past taking action', async () => {
      const runId = await seedRun(10);
      await testDb.db.update(run).set({ state: 'COMPLETED' }).where(eq(run.id, runId));

      await expect(ledger.raiseBudget({ runId, newCapUsd: 20 })).rejects.toThrow();
    });
  });
});
