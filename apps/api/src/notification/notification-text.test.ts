import { describe, expect, it } from 'vitest';
import { NotificationKind } from '@reelcraft/shared';
import { describeRunNotification, type NotificationTextContext } from './notification-text';

const base: NotificationTextContext = {
  runId: 'run1',
  blueprintName: 'Shorts',
  channelName: 'Cooking',
  draft: false,
};

describe('describeRunNotification', () => {
  it('has wording and a link for every kind', () => {
    for (const kind of NotificationKind.options) {
      const text = describeRunNotification(kind, {
        ...base,
        stageKey: 'script',
        waitKind: 'approval',
      });
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.body).toContain('Shorts');
      expect(text.url.startsWith('/runs/run1')).toBe(true);
    }
  });

  it('opens the review sheet for an approval', () => {
    expect(
      describeRunNotification('awaiting_approval', {
        ...base,
        stageKey: 'script',
        stageLabel: 'Write script',
        waitKind: 'approval',
      }),
    ).toMatchObject({
      title: 'Approval needed',
      body: 'Write script is ready for your review. Shorts · Cooking',
      url: '/runs/run1?review=script',
    });
  });

  it('opens the form for input and the editor for a timeline edit', () => {
    const input = describeRunNotification('awaiting_input', {
      ...base,
      stageKey: 'brief',
      waitKind: 'input',
    });
    expect(input).toMatchObject({ title: 'Input needed', url: '/runs/run1?input=brief' });

    const edit = describeRunNotification('awaiting_input', {
      ...base,
      stageKey: 'cut',
      waitKind: 'timeline_edit',
    });
    expect(edit).toMatchObject({
      title: 'Timeline edit needed',
      url: '/runs/run1/stages/cut/edit',
    });
  });

  it('url-encodes stage keys', () => {
    expect(
      describeRunNotification('awaiting_approval', {
        ...base,
        stageKey: 'a b&c',
        waitKind: 'approval',
      }).url,
    ).toBe('/runs/run1?review=a%20b%26c');
  });

  it('falls back to the run page when the wait or stage is unknown', () => {
    expect(describeRunNotification('awaiting_approval', base).url).toBe('/runs/run1');
    expect(
      describeRunNotification('reminder', { ...base, stageKey: 's', waitKind: null }).url,
    ).toBe('/runs/run1');
  });

  it('puts the failing stage and a clipped single-line reason in the body', () => {
    const long = 'x'.repeat(500);
    const text = describeRunNotification('failed', {
      ...base,
      stageKey: 'render',
      stageLabel: 'Render',
      reason: `bad\nthing ${long}`,
    });
    expect(text.title).toBe('Run failed');
    expect(text.body.startsWith('Render failed: bad thing x')).toBe(true);
    expect(text.body).not.toContain('\n');
    expect(text.body.length).toBeLessThan(300);
    expect(text.url).toBe('/runs/run1');
  });

  it('copes with a missing failure reason', () => {
    expect(
      describeRunNotification('failed', { ...base, stageLabel: 'Render', reason: null }).body,
    ).toBe('Render failed. Shorts · Cooking');
  });

  it('marks canvas runs and says how long a reminder has waited', () => {
    expect(describeRunNotification('completed', { ...base, draft: true }).body).toBe(
      'Shorts (canvas run) · Cooking',
    );
    expect(
      describeRunNotification('reminder', { ...base, stageLabel: 'Review', hours: 48 }).body,
    ).toContain('48 hours');
  });
});
