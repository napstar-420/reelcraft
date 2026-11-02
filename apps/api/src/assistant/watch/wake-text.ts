import type { NotificationKind } from '@reelcraft/shared';

/** The run notifications that wake a watching chat. Not `run_started`, `auto_resumed`,
 * `paused_quota` (it resumes by itself) or `reminder`. */
export const WAKE_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'failed',
  'awaiting_approval',
  'awaiting_input',
  'paused_budget',
  'completed',
  'cancelled',
]);

/** After these the run is over: the watch ends once the chat has been told. */
export const FINAL_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'completed',
  'cancelled',
]);

const NEXT: Record<string, string> = {
  failed:
    "Find out why (get_run, get_stage, get_attempt), fix the cause in the blueprint, then re-make what the fix changes (run_stages), or retry_stage when it was not the blueprint's fault. If you already tried twice, stop and tell the user what you found.",
  awaiting_approval:
    'Look at what it made (get_stage, view_media, listen). Approve it if it meets the brief, or reject it with a specific note; when it is a matter of taste, ask the user.',
  awaiting_input:
    'It needs someone to fill in a form. Fill it in only with what the user told you; otherwise tell the user it is waiting for them.',
  paused_budget:
    'It ran out of budget. Say what it has spent and what is left to do; raise_budget only when the user asked you to finish it.',
  completed:
    'Review the result (view_media and listen on the final video), then tell the user how it turned out and anything worth improving.',
  cancelled: 'Tell the user it was stopped, and where.',
};

/** What a watching chat is told when its run wakes it. */
export function wakeText(input: {
  runId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  wake: number;
  maxWakes: number;
}): string {
  const handle = `#${input.runId.slice(-8).toLowerCase()}`;
  const last = input.wake >= input.maxWakes;
  return [
    `[Run update: you are watching run ${handle} (runId ${input.runId})] ${input.title}. ${input.body}`,
    NEXT[input.kind] ?? '',
    last
      ? `This is wake-up ${input.wake} of ${input.maxWakes}: you stop watching this run after this one.`
      : `Wake-up ${input.wake} of ${input.maxWakes}.`,
  ]
    .filter(Boolean)
    .join('\n');
}
