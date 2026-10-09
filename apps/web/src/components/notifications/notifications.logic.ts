import type { NotificationKind } from '@reelcraft/shared';
import { isKindEnabled, type NotificationPrefs } from '../../lib/notification-prefs';

/** A toast interrupts only a tab the user is looking at, only for a kind they
 * have not turned off, and not when a system notification already covers it
 * (one alert per browser). */
export function shouldToast(input: {
  kind: NotificationKind;
  prefs: NotificationPrefs;
  visible: boolean;
  pushActive: boolean;
}): boolean {
  return input.visible && !input.pushActive && isKindEnabled(input.prefs, input.kind);
}

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export function toastTone(kind: NotificationKind): ToastTone {
  switch (kind) {
    case 'failed':
      return 'error';
    case 'completed':
      return 'success';
    case 'awaiting_approval':
    case 'awaiting_input':
    case 'paused_budget':
    case 'paused_quota':
    case 'reminder':
      return 'warning';
    default:
      return 'info';
  }
}

/** Things that need the user stay on screen longer than FYIs. */
export function toastDurationMs(kind: NotificationKind): number {
  return toastTone(kind) === 'warning' || kind === 'failed' ? 10_000 : 5_000;
}

export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
