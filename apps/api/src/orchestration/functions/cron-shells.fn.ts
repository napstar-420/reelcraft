import type { Inngest } from 'inngest';

/**
 * §11.4/§4.5/§4.4 — no-op shells so the topology (§13.4) is visible from
 * phase 1. Phase 3 fills budgetSweep (orphaned reservations), phase-1's
 * §4.5 blob GC and the compute-job reaper fill the other two once their
 * subsystems exist.
 */
export function buildCronShellFunctions(client: Inngest) {
  const budgetSweep = client.createFunction(
    { id: 'budget.sweep' },
    { cron: '*/5 * * * *' },
    async () => {
      // phase 3: sweep expired reservations (§11.4)
    },
  );

  const blobGc = client.createFunction({ id: 'blob.gc' }, { cron: '0 * * * *' }, async () => {
    // phase 5+: collect gc_eligible blobs past retention (§4.5)
  });

  const jobReaper = client.createFunction(
    { id: 'compute-job.reap' },
    { cron: '*/10 * * * *' },
    async () => {
      // phase 6: reap orphaned ComputeJobService job directories (§4.4)
    },
  );

  return [budgetSweep, blobGc, jobReaper];
}
