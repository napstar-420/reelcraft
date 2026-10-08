import { z } from 'zod';

/** What happened to a run that the user may want to hear about. */
export const NotificationKind = z.enum([
  'run_started',
  'awaiting_approval',
  'awaiting_input',
  'paused_budget',
  'paused_quota',
  'auto_resumed',
  'failed',
  'completed',
  'cancelled',
  'reminder',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationDto = z.object({
  id: z.string(),
  kind: NotificationKind,
  runId: z.string(),
  stageKey: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  /** In-app path to open: the run, or the exact review/input/editor view. */
  url: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const ListNotificationsResultDto = z.object({
  items: z.array(NotificationDto),
  unreadCount: z.number().int().nonnegative(),
});
export type ListNotificationsResultDto = z.infer<typeof ListNotificationsResultDto>;
