import { describe, expect, it } from 'vitest';
import { shouldToast, toastDurationMs, toastTone, unreadLabel } from './notifications.logic';

describe('shouldToast', () => {
  const base = { kind: 'failed' as const, prefs: {}, visible: true, pushActive: false };

  it('toasts a visible tab for an enabled kind', () => {
    expect(shouldToast(base)).toBe(true);
  });

  it('stays quiet in a hidden tab', () => {
    expect(shouldToast({ ...base, visible: false })).toBe(false);
  });

  it('stays quiet when a system notification already covers this browser', () => {
    expect(shouldToast({ ...base, pushActive: true })).toBe(false);
  });

  it('respects the kind switches, including the off-by-default cancelled', () => {
    expect(shouldToast({ ...base, prefs: { kinds: { failed: false } } })).toBe(false);
    expect(shouldToast({ ...base, kind: 'cancelled' })).toBe(false);
    expect(shouldToast({ ...base, kind: 'cancelled', prefs: { kinds: { cancelled: true } } })).toBe(
      true,
    );
  });
});

describe('toast presentation', () => {
  it('uses error, success and warning tones for the outcomes that matter', () => {
    expect(toastTone('failed')).toBe('error');
    expect(toastTone('completed')).toBe('success');
    expect(toastTone('awaiting_approval')).toBe('warning');
    expect(toastTone('run_started')).toBe('info');
  });

  it('keeps things that need the user on screen longer', () => {
    expect(toastDurationMs('awaiting_approval')).toBeGreaterThan(toastDurationMs('run_started'));
    expect(toastDurationMs('failed')).toBeGreaterThan(toastDurationMs('completed'));
  });
});

describe('unreadLabel', () => {
  it('hides zero, shows the count, and caps at 99+', () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(99)).toBe('99');
    expect(unreadLabel(100)).toBe('99+');
  });
});
