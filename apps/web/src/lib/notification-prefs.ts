import type { NotificationKind } from '@reelcraft/shared';

/** The words for each notification kind in Settings, and whether it interrupts
 * by default. Typed as a Record so adding a kind to the shared enum fails to
 * compile here until it has a label. */
export const NOTIFICATION_KIND_INFO: Record<
  NotificationKind,
  { label: string; hint: string; defaultOn: boolean }
> = {
  awaiting_approval: {
    label: 'Approval needed',
    hint: 'A stage is waiting for you to review its output.',
    defaultOn: true,
  },
  awaiting_input: {
    label: 'Input needed',
    hint: 'A run is waiting for a form or a timeline edit.',
    defaultOn: true,
  },
  paused_budget: {
    label: 'Paused for budget',
    hint: 'A run hit its budget and needs it raised to continue.',
    defaultOn: true,
  },
  paused_quota: {
    label: 'Paused for provider quota',
    hint: 'A provider is out of quota. The run resumes by itself when it resets.',
    defaultOn: true,
  },
  failed: { label: 'Run failed', hint: 'A run stopped with an error.', defaultOn: true },
  completed: { label: 'Run completed', hint: 'A run finished.', defaultOn: true },
  run_started: { label: 'Run started', hint: 'A run began working.', defaultOn: true },
  auto_resumed: {
    label: 'Run resumed after quota reset',
    hint: 'A run that was waiting for provider quota continued by itself.',
    defaultOn: true,
  },
  reminder: {
    label: 'Still waiting for you',
    hint: 'A reminder after a run has waited for you for 24 and 48 hours.',
    defaultOn: true,
  },
  cancelled: {
    label: 'Run cancelled',
    hint: 'A run was cancelled. Off by default: you usually just did it.',
    defaultOn: false,
  },
};

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_KIND_INFO) as NotificationKind[];

/** This browser's choices about which notifications interrupt it (toasts and
 * system notifications). The inbox always records every kind. A
 * convenience only: storage can be missing or blocked, so every access is
 * guarded. */
export interface NotificationPrefs {
  kinds?: Partial<Record<NotificationKind, boolean>>;
  /** System notifications are switched on in this browser. */
  push?: boolean;
}

const KEY = 'reelcraft.notifications';

export function isKindEnabled(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  return prefs.kinds?.[kind] ?? NOTIFICATION_KIND_INFO[kind].defaultOn;
}

/** The kinds this browser wants as system notifications. */
export function enabledKinds(prefs: NotificationPrefs): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((kind) => isKindEnabled(prefs, kind));
}

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as NotificationPrefs) : {};
  } catch {
    return {};
  }
}

export function saveNotificationPrefs(patch: NotificationPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...loadNotificationPrefs(), ...patch }));
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}
