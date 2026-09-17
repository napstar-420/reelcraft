import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ulid } from '../common/ulid';
import { fromUsd, toUsd } from '../common/money';
import { DRIZZLE, type Db, type Tx } from '../db/drizzle.provider';
import { ledgerEntry, run } from '../db/schema/index';

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: 'run_cap_exceeded' | 'stage_cap_exceeded' };

type ReservationCategory = 'stage_output';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/**
 * §11 — row-locked reserve/settle over the ledger. `run.{reservedUsd,
 * spentUsd,budgetCapUsd}` are materialized totals; the ledger itself
 * remains the source of truth (§11.1), so every method here that mutates
 * one of those three columns does so inside a transaction that also writes
 * the corresponding `ledger_entry` row(s) in the same commit.
 *
 * Two distinct locks matter, taken for different reasons:
 * - `lockRunRow` (`SELECT ... FOR UPDATE` on `run`) — serializes budget
 *   mutations against each other and lets `reserve`/`raiseBudget` re-check
 *   state before acting (§11.1's general rationale, not just the
 *   reservation-time example it shows).
 * - `lockReservation` (`SELECT ... FOR UPDATE` on the specific
 *   `ledger_entry` reservation row) — this is what actually prevents
 *   `budget.sweep` (phase-3 chunk 3) and a live `settle*` call from
 *   double-processing the SAME reservation: whichever gets there first
 *   holds the row lock until commit, and the other's `alreadySettled`
 *   check (evaluated under that same lock) then sees the first one's
 *   already-written `actual`/`release` row and no-ops.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * §11.1/§13.2 Rule 2 — idempotent the same way `beginAttempt` is: a
   * replayed `step.run('submit-...')` calls this twice for the SAME
   * `stageAttemptId`. The `ledger_one_reservation_per_attempt` partial
   * unique index turns the second call's insert into a unique-violation,
   * which is caught and turned into a re-select rather than a second
   * increment of `run.reservedUsd`.
   */
  async reserve(params: {
    runId: string;
    stageKey: string;
    stageAttemptId: string;
    category: ReservationCategory;
    ceilingUsd: number;
    stageCapUsd?: number | undefined;
    preSubmitTtlSec: number;
  }): Promise<ReserveResult> {
    return this.db.transaction(async (tx) => {
      const runRow = await this.lockRunRow(tx, params.runId);

      const runAvailable =
        toUsd(runRow.budgetCapUsd) - toUsd(runRow.reservedUsd) - toUsd(runRow.spentUsd);
      if (params.ceilingUsd > runAvailable) {
        return { ok: false, reason: 'run_cap_exceeded' };
      }

      if (params.stageCapUsd !== undefined) {
        const stageCommitted = await this.stageCommittedUsd(tx, {
          runId: params.runId,
          stageKey: params.stageKey,
          category: params.category,
        });
        const stageAvailable = params.stageCapUsd - stageCommitted;
        if (params.ceilingUsd > stageAvailable) {
          return { ok: false, reason: 'stage_cap_exceeded' };
        }
      }

      const reservationId = ulid();
      try {
        // A plain insert here would, on conflict, abort the WHOLE outer
        // transaction (Postgres refuses any further statements once one
        // fails) — the catch block's re-select below would then fail too,
        // with a confusing "transaction is aborted" error masking the real
        // one. Wrapping just the insert in a nested `tx.transaction()`
        // (drizzle-orm's postgres-js driver implements this as a real
        // SAVEPOINT — confirmed by reading `postgres-js/session.js`)
        // contains the failure to a sub-transaction that rolls back on its
        // own, leaving the outer transaction healthy for the re-select.
        await tx.transaction(async (savepointTx) => {
          await savepointTx.insert(ledgerEntry).values({
            id: reservationId,
            runId: params.runId,
            stageKey: params.stageKey,
            stageAttemptId: params.stageAttemptId,
            kind: 'reservation',
            category: params.category,
            amountUsd: fromUsd(params.ceilingUsd),
            expiresAt: new Date(Date.now() + params.preSubmitTtlSec * 1000).toISOString(),
          });
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const [existing] = await tx
          .select({ id: ledgerEntry.id })
          .from(ledgerEntry)
          .where(
            and(
              eq(ledgerEntry.stageAttemptId, params.stageAttemptId),
              eq(ledgerEntry.kind, 'reservation'),
            ),
          )
          .limit(1);
        if (!existing) throw err;
        return { ok: true, reservationId: existing.id };
      }

      await tx
        .update(run)
        .set({ reservedUsd: sql`${run.reservedUsd} + ${fromUsd(params.ceilingUsd)}` })
        .where(eq(run.id, params.runId));

      return { ok: true, reservationId };
    });
  }

  /** The one open reservation for a stage attempt — enforced by the
   * `ledger_one_reservation_per_attempt` partial unique index, so "the"
   * reservation is well-defined. Lets callers past `reserveAndSubmit`
   * (which already knows its own `reservationId`) settle a reservation
   * without threading that id through `StageAttemptContext`/`JobHandle`. */
  async reservationIdFor(stageAttemptId: string): Promise<string> {
    const [row] = await this.db
      .select({ id: ledgerEntry.id })
      .from(ledgerEntry)
      .where(
        and(eq(ledgerEntry.stageAttemptId, stageAttemptId), eq(ledgerEntry.kind, 'reservation')),
      )
      .limit(1);
    if (!row)
      throw new Error(`LedgerService: no reservation found for stage attempt ${stageAttemptId}`);
    return row.id;
  }

  /** §11.4 — anchors the reservation's `expires_at` to the post-submit
   * allowance instead of the pre-submit TTL, now that a real provider call
   * has actually been made. Does not touch `run.reservedUsd`. */
  async markSubmitted(reservationId: string, postSubmitTtlSec: number): Promise<void> {
    await this.db
      .update(ledgerEntry)
      .set({ expiresAt: new Date(Date.now() + postSubmitTtlSec * 1000).toISOString() })
      .where(and(eq(ledgerEntry.id, reservationId), eq(ledgerEntry.kind, 'reservation')));
  }

  /** §11.3 — the confirmed-success settlement: a confirmed `actual` at the
   * true cost plus a confirmed `release` of the full ceiling, so the
   * reservation's ceiling and the real spend are both visible in the
   * ledger rather than the release silently absorbing the difference. */
  async settleSuccess(params: {
    runId: string;
    stageKey: string;
    stageAttemptId: string;
    reservationId: string;
    actualUsd: number;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRunRow(tx, params.runId);
      const reservation = await this.lockReservation(tx, params.reservationId);
      if (await this.alreadySettled(tx, params.reservationId)) {
        this.logger.warn(`settleSuccess: reservation ${params.reservationId} already settled`);
        return;
      }
      const ceilingUsd = toUsd(reservation.amountUsd);

      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'actual',
        category: 'stage_output',
        amountUsd: fromUsd(params.actualUsd),
        confirmed: true,
        reservationId: params.reservationId,
      });
      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'release',
        category: 'stage_output',
        amountUsd: fromUsd(ceilingUsd),
        confirmed: true,
        reservationId: params.reservationId,
      });
      await tx
        .update(run)
        .set({
          reservedUsd: sql`${run.reservedUsd} - ${fromUsd(ceilingUsd)}`,
          spentUsd: sql`${run.spentUsd} + ${fromUsd(params.actualUsd)}`,
        })
        .where(eq(run.id, params.runId));
    });
  }

  /** §11.3 — "unconfirmed outcomes settle as provisional actuals, not
   * releases": the engine stopped polling (or a cancel couldn't be
   * confirmed) without definitive information, so the ledger stays
   * conservative and books the full ceiling as spent rather than
   * releasing it. `confirmed:false` lets a later reconciliation correct
   * downward. */
  async settleProvisional(params: {
    runId: string;
    stageKey: string;
    stageAttemptId: string;
    reservationId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRunRow(tx, params.runId);
      const reservation = await this.lockReservation(tx, params.reservationId);
      if (await this.alreadySettled(tx, params.reservationId)) {
        this.logger.warn(`settleProvisional: reservation ${params.reservationId} already settled`);
        return;
      }
      const ceilingUsd = toUsd(reservation.amountUsd);

      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'actual',
        category: 'stage_output',
        amountUsd: fromUsd(ceilingUsd),
        confirmed: false,
        reservationId: params.reservationId,
      });
      await tx
        .update(run)
        .set({
          reservedUsd: sql`${run.reservedUsd} - ${fromUsd(ceilingUsd)}`,
          spentUsd: sql`${run.spentUsd} + ${fromUsd(ceilingUsd)}`,
        })
        .where(eq(run.id, params.runId));
    });
  }

  /** §11.3 — "a confirmed non-billing failure... writes a plain release":
   * nothing was billed, so only `run.reservedUsd` moves. */
  async settleRelease(params: {
    runId: string;
    stageKey: string;
    stageAttemptId: string;
    reservationId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockRunRow(tx, params.runId);
      const reservation = await this.lockReservation(tx, params.reservationId);
      if (await this.alreadySettled(tx, params.reservationId)) {
        this.logger.warn(`settleRelease: reservation ${params.reservationId} already settled`);
        return;
      }
      const ceilingUsd = toUsd(reservation.amountUsd);

      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'release',
        category: 'stage_output',
        amountUsd: fromUsd(ceilingUsd),
        confirmed: true,
        reservationId: params.reservationId,
      });
      await tx
        .update(run)
        .set({ reservedUsd: sql`${run.reservedUsd} - ${fromUsd(ceilingUsd)}` })
        .where(eq(run.id, params.runId));
    });
  }

  /** §12.4 — the one budget mutation allowed while `RUNNING`; also used to
   * unblock a `PAUSED_BUDGET` run (phase-3 chunk 2). Rejects a cap that
   * doesn't actually widen anything and a run that's past taking action. */
  async raiseBudget(params: {
    runId: string;
    newCapUsd: number;
  }): Promise<{ budgetCapUsd: number }> {
    return this.db.transaction(async (tx) => {
      const runRow = await this.lockRunRow(tx, params.runId);
      if (runRow.state === 'COMPLETED' || runRow.state === 'CANCELLED') {
        throw new Error(
          `LedgerService.raiseBudget: run ${params.runId} is ${runRow.state}, budget cannot be raised`,
        );
      }
      const currentCapUsd = toUsd(runRow.budgetCapUsd);
      if (params.newCapUsd <= currentCapUsd) {
        throw new Error(
          `LedgerService.raiseBudget: newCapUsd (${params.newCapUsd}) must exceed the current cap (${currentCapUsd})`,
        );
      }
      await tx
        .update(run)
        .set({ budgetCapUsd: fromUsd(params.newCapUsd) })
        .where(eq(run.id, params.runId));
      return { budgetCapUsd: params.newCapUsd };
    });
  }

  /** §10.4 — cumulative confirmed QC spend for `(run, stage)`, read by
   * `StageRunnerService.fetchAndFinalize`'s `qc_budget_exhausted` gate
   * before ever calling the judge. See the Decision note there for why QC
   * gets a cumulative-spend check rather than a reservation. */
  async qcSpentUsd(runId: string, stageKey: string): Promise<number> {
    const rows = await this.db
      .select({ amountUsd: ledgerEntry.amountUsd })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, runId),
          eq(ledgerEntry.stageKey, stageKey),
          eq(ledgerEntry.category, 'qc'),
          eq(ledgerEntry.kind, 'actual'),
          eq(ledgerEntry.confirmed, true),
        ),
      );
    return rows.reduce((total, row) => total + toUsd(row.amountUsd), 0);
  }

  /** §10 — QC's own spend record, unchanged since phase 2: a plain
   * confirmed `actual`, no reservation (QC never reserves — Decision 1). */
  async recordActual(params: {
    runId: string;
    stageKey: string;
    stageAttemptId?: string;
    category: 'stage_output' | 'qc' | 'check';
    amountUsd: number;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(ledgerEntry).values({
        id: ulid(),
        runId: params.runId,
        stageKey: params.stageKey,
        stageAttemptId: params.stageAttemptId,
        kind: 'actual',
        category: params.category,
        amountUsd: fromUsd(params.amountUsd),
        confirmed: true,
      });
      await tx
        .update(run)
        .set({ spentUsd: sql`${run.spentUsd} + ${fromUsd(params.amountUsd)}` })
        .where(eq(run.id, params.runId));
    });
  }

  private async lockRunRow(
    tx: Tx,
    runId: string,
  ): Promise<{ reservedUsd: string; spentUsd: string; budgetCapUsd: string; state: string }> {
    const [row] = await tx
      .select({
        reservedUsd: run.reservedUsd,
        spentUsd: run.spentUsd,
        budgetCapUsd: run.budgetCapUsd,
        state: run.state,
      })
      .from(run)
      .where(eq(run.id, runId))
      .for('update');
    if (!row) throw new Error(`LedgerService: run ${runId} not found`);
    return row;
  }

  private async lockReservation(
    tx: Tx,
    reservationId: string,
  ): Promise<{ id: string; amountUsd: string }> {
    const [row] = await tx
      .select({ id: ledgerEntry.id, amountUsd: ledgerEntry.amountUsd })
      .from(ledgerEntry)
      .where(and(eq(ledgerEntry.id, reservationId), eq(ledgerEntry.kind, 'reservation')))
      .for('update');
    if (!row) throw new Error(`LedgerService: reservation ${reservationId} not found`);
    return row;
  }

  /** True once some `actual`/`release` row's `reservation_id` already
   * points back at this reservation — the guard that makes every `settle*`
   * method safe to call twice (a live settlement racing `budget.sweep`,
   * phase-3 chunk 3) without double-adjusting `run.reservedUsd`/`spentUsd`. */
  private async alreadySettled(tx: Tx, reservationId: string): Promise<boolean> {
    const [existing] = await tx
      .select({ id: ledgerEntry.id })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.reservationId, reservationId),
          inArray(ledgerEntry.kind, ['actual', 'release']),
        ),
      )
      .limit(1);
    return existing !== undefined;
  }

  /** §11.2 — "open reservation ceilings + confirmed actuals" for one
   * `(run, stage, category)`, the stage-scope committed total `reserve()`
   * checks `stageCapUsd` against. A reservation counts as "open" until some
   * settlement row's `reservation_id` points back at it — computed here
   * from two plain queries rather than a correlated SQL subquery, since
   * both result sets are small (at most one open reservation can exist per
   * attempt) and this keeps the logic readable in TypeScript. */
  private async stageCommittedUsd(
    tx: Tx,
    params: { runId: string; stageKey: string; category: ReservationCategory },
  ): Promise<number> {
    const reservations = await tx
      .select({ id: ledgerEntry.id, amountUsd: ledgerEntry.amountUsd })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, params.runId),
          eq(ledgerEntry.stageKey, params.stageKey),
          eq(ledgerEntry.category, params.category),
          eq(ledgerEntry.kind, 'reservation'),
        ),
      );
    const settlements = await tx
      .select({
        reservationId: ledgerEntry.reservationId,
        amountUsd: ledgerEntry.amountUsd,
        kind: ledgerEntry.kind,
        confirmed: ledgerEntry.confirmed,
      })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.runId, params.runId),
          eq(ledgerEntry.stageKey, params.stageKey),
          eq(ledgerEntry.category, params.category),
          inArray(ledgerEntry.kind, ['actual', 'release']),
        ),
      );

    const settledReservationIds = new Set(
      settlements.map((s) => s.reservationId).filter((id): id is string => id !== null),
    );
    const openReservationTotal = reservations
      .filter((r) => !settledReservationIds.has(r.id))
      .reduce((total, r) => total + toUsd(r.amountUsd), 0);
    const confirmedActualTotal = settlements
      .filter((s) => s.kind === 'actual' && s.confirmed)
      .reduce((total, s) => total + toUsd(s.amountUsd), 0);

    return openReservationTotal + confirmedActualTotal;
  }
}
