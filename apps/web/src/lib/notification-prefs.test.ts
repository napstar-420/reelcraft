import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_KINDS,
  enabledKinds,
  isKindEnabled,
  loadNotificationPrefs,
  saveNotificationPrefs,
} from './notification-prefs';

function fakeStorage(initial?: string) {
  const store = new Map<string, string>(
    initial === undefined ? [] : [['reelcraft.notifications', initial]],
  );
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('isKindEnabled', () => {
  it('defaults every kind on except cancelled', () => {
    const off = NOTIFICATION_KINDS.filter((kind) => !isKindEnabled({}, kind));
    expect(off).toEqual(['cancelled']);
  });

  it('lets the user override either way', () => {
    expect(isKindEnabled({ kinds: { failed: false } }, 'failed')).toBe(false);
    expect(isKindEnabled({ kinds: { cancelled: true } }, 'cancelled')).toBe(true);
    expect(isKindEnabled({ kinds: { failed: false } }, 'completed')).toBe(true);
  });
});

describe('enabledKinds', () => {
  it('lists what interrupts this browser', () => {
    expect(enabledKinds({})).toHaveLength(NOTIFICATION_KINDS.length - 1);
    expect(enabledKinds({})).not.toContain('cancelled');
    const some = enabledKinds({ kinds: { failed: false, cancelled: true } });
    expect(some).not.toContain('failed');
    expect(some).toContain('cancelled');
  });
});

describe('load and save', () => {
  it('round-trips and merges a patch', () => {
    fakeStorage();
    saveNotificationPrefs({ kinds: { failed: false } });
    expect(loadNotificationPrefs()).toEqual({ kinds: { failed: false } });
  });

  it('survives missing, corrupt and non-object storage', () => {
    vi.stubGlobal('window', undefined); // no storage at all
    expect(loadNotificationPrefs()).toEqual({});
    expect(() => saveNotificationPrefs({ kinds: {} })).not.toThrow();
    fakeStorage('{not json');
    expect(loadNotificationPrefs()).toEqual({});
    fakeStorage('"a string"');
    expect(loadNotificationPrefs()).toEqual({});
  });
});
