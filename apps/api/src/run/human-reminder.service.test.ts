import { describe, expect, it } from 'vitest';
import { dueReminderThreshold } from './human-reminder.service';

describe('dueReminderThreshold', () => {
  const now = Date.parse('2026-09-18T00:00:00.000Z');

  it('emits each reminder only once and prefers the oldest outstanding threshold', () => {
    expect(
      dueReminderThreshold(
        { waitingSince: '2026-09-16T00:00:00.000Z', reminded24hAt: null, reminded48hAt: null },
        now,
      ),
    ).toBe(24);
    expect(
      dueReminderThreshold(
        {
          waitingSince: '2026-09-16T00:00:00.000Z',
          reminded24hAt: '2026-09-17T00:00:00.000Z',
          reminded48hAt: null,
        },
        now,
      ),
    ).toBe(48);
    expect(
      dueReminderThreshold(
        { waitingSince: '2026-09-16T00:00:00.000Z', reminded24hAt: 'x', reminded48hAt: 'y' },
        now,
      ),
    ).toBeNull();
  });
});
