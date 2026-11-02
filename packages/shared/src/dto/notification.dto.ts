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
  /** The assistant is waiting for you (an approval, a question or a plan) and no page shows it. */
  'assistant_needs_you',
  /** The assistant finished dealing with a run update while no page showed the chat. */
  'assistant_done',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationDto = z.object({
  id: z.string(),
  kind: NotificationKind,
  /** Null for an assistant notification. */
  runId: z.string().nullable(),
  /** The assistant chat it is about, if any. */
  sessionId: z.string().nullable(),
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

/** A push service's address for one browser. It is called by the server, so
 * only a public https host is accepted: not an IP address or localhost, which
 * would let a request make the server call something on its own network. */
function isPublicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return (
      url.protocol === 'https:' &&
      host !== 'localhost' &&
      !host.endsWith('.localhost') &&
      !host.startsWith('[') &&
      !/^[\d.]+$/.test(host)
    );
  } catch {
    return false;
  }
}

/** What a browser hands over when it subscribes, plus which kinds it wants. */
export const PushSubscriptionDto = z.object({
  endpoint: z.string().max(2048).refine(isPublicHttps, 'must be a public https address'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  kinds: z.array(NotificationKind).max(NotificationKind.options.length),
});
export type PushSubscriptionDto = z.infer<typeof PushSubscriptionDto>;

export const DeletePushSubscriptionDto = z.object({ endpoint: z.string().max(2048) });
export type DeletePushSubscriptionDto = z.infer<typeof DeletePushSubscriptionDto>;

export const VapidKeyDto = z.object({ publicKey: z.string() });
export type VapidKeyDto = z.infer<typeof VapidKeyDto>;
