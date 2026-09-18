import type { Inngest } from 'inngest';
import type { RunWakeupDispatcher } from '../../run/run-wakeup-dispatcher.service';

/** Retries committed outbox rows whose immediate delivery failed. */
export function buildRunWakeupDispatchFunction(client: Inngest, dispatcher: RunWakeupDispatcher) {
  return client.createFunction(
    { id: 'run.wakeup-dispatch' },
    { cron: '* * * * *' },
    async ({ step }) => step.run('dispatch-pending-wakeups', () => dispatcher.dispatchPending()),
  );
}
