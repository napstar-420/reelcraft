import type { Inngest } from 'inngest';
import type { LedgerService } from '../../budget/ledger.service';

/** §11.4 — the real `budget.sweep` implementation, split out of
 * `cron-shells.fn.ts` now that it has one (that file stays for topology
 * shells whose subsystems don't exist yet). See
 * `LedgerService.sweepExpiredReservations` for the algorithm. */
export function buildBudgetSweepFunction(client: Inngest, ledger: LedgerService) {
  return client.createFunction({ id: 'budget.sweep' }, { cron: '*/5 * * * *' }, () =>
    ledger.sweepExpiredReservations(),
  );
}
