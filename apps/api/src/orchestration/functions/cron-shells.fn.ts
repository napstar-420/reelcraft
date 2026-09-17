import type { Inngest } from 'inngest';

/**
 * §4.5/§4.4 — no-op shells so the topology (§13.4) is visible from phase 1.
 * `budget.sweep` (§11.4, orphaned reservations) moved to its own
 * `budget-sweep.fn.ts` in phase 3, now that it has a real implementation.
 * Phase 5+'s blob GC and phase 6's compute-job reaper fill the remaining
 * two once their subsystems exist.
 */
export function buildCronShellFunctions(client: Inngest) {
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

  return [blobGc, jobReaper];
}
