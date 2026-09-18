import type { Inngest } from 'inngest';
import type { HumanReminderService } from '../../run/human-reminder.service';

export function buildHumanReminderSweepFunction(client: Inngest, reminders: HumanReminderService) {
  return client.createFunction(
    { id: 'human.reminder-sweep' },
    { cron: '0 * * * *' },
    async ({ step }) => step.run('claim-due-human-reminders', () => reminders.sweep()),
  );
}
