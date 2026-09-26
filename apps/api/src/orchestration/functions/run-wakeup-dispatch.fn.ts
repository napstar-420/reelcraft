import type { Inngest } from 'inngest';
import type { RunWakeupDispatcher } from '../../run/run-wakeup-dispatcher.service';

/** Retries committed outbox rows whose immediate delivery failed. */
export function buildRunWakeupDispatchFunction(client: Inngest, dispatcher: RunWakeupDispatcher) {
  return client.createFunction(
    { id: 'run.wakeup-dispatch' },
    { cron: '* * * * *' },
    async ({ step, logger }) => {
      const result = await step.run('dispatch-pending-wakeups', () => dispatcher.dispatchPending());
      if (result.failed > 0) {
        logger.warn({ ...result }, 'pending run wakeups dispatch had failures');
      } else if (result.dispatched > 0) {
        logger.info({ ...result }, 'pending run wakeups dispatched');
      }
      return result;
    },
  );
}
