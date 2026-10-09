import type { NotificationKind } from '@reelcraft/shared';

export interface NotificationTextContext {
  runId: string;
  blueprintName: string;
  channelName: string;
  /** A canvas run of unsaved edits, not of a saved version. */
  draft: boolean;
  stageKey?: string | null;
  stageLabel?: string | null;
  /** What the open human wait is for (approval, form input or timeline edit). */
  waitKind?: 'approval' | 'input' | 'timeline_edit' | null;
  /** Why the run failed. */
  reason?: string | null;
  /** How long a reminder's wait has gone unanswered. */
  hours?: 24 | 48;
}

export interface NotificationText {
  title: string;
  body: string;
  url: string;
}

const MAX_REASON = 200;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The words and the in-app link for one notification. Pure, so the exact
 * wording and the deep links are pinned by unit tests. The link is stored on
 * the row so the bell, a toast and an OS notification all open the same view. */
export function describeRunNotification(
  kind: NotificationKind,
  ctx: NotificationTextContext,
): NotificationText {
  const runName = `${ctx.blueprintName}${ctx.draft ? ' (canvas run)' : ''} · ${ctx.channelName}`;
  const stage = ctx.stageLabel ?? ctx.stageKey ?? 'A stage';
  const runUrl = `/runs/${ctx.runId}`;
  const key = ctx.stageKey ? encodeURIComponent(ctx.stageKey) : null;

  const waitUrl = (): string => {
    if (!key) return runUrl;
    if (ctx.waitKind === 'timeline_edit') return `${runUrl}/stages/${key}/edit`;
    if (ctx.waitKind === 'input') return `${runUrl}?input=${key}`;
    if (ctx.waitKind === 'approval') return `${runUrl}?review=${key}`;
    return runUrl;
  };

  switch (kind) {
    case 'run_started':
      return { title: 'Run started', body: runName, url: runUrl };
    case 'awaiting_approval':
      return {
        title: 'Approval needed',
        body: `${stage} is ready for your review. ${runName}`,
        url: waitUrl(),
      };
    case 'awaiting_input':
      return {
        title: ctx.waitKind === 'timeline_edit' ? 'Timeline edit needed' : 'Input needed',
        body: `${stage} is waiting for you. ${runName}`,
        url: waitUrl(),
      };
    case 'paused_budget':
      return {
        title: 'Paused: budget reached',
        body: `Raise the budget to continue. ${runName}`,
        url: runUrl,
      };
    case 'paused_quota':
      return {
        title: 'Paused: provider quota reached',
        body: `It will resume by itself when the quota resets. ${runName}`,
        url: runUrl,
      };
    case 'auto_resumed':
      return { title: 'Run resumed', body: `The quota reset. ${runName}`, url: runUrl };
    case 'failed':
      return {
        title: 'Run failed',
        body: ctx.reason
          ? `${stage} failed: ${clip(ctx.reason, MAX_REASON)} ${runName}`
          : `${stage} failed. ${runName}`,
        url: runUrl,
      };
    case 'completed':
      return { title: 'Run completed', body: runName, url: runUrl };
    case 'cancelled':
      return { title: 'Run cancelled', body: runName, url: runUrl };
    case 'reminder':
      return {
        title: 'Still waiting for you',
        body: `${stage} has waited ${ctx.hours ?? 24} hours. ${runName}`,
        url: waitUrl(),
      };
  }
}
