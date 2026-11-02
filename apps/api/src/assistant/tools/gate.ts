import type { ApprovalRequest, ToolOutcome, TurnContext } from './types';

const WAITING =
  "You asked the user a question. End your turn now: the answers arrive as the user's next message. Don't change anything until then.";
const PLANNED =
  "You presented a plan. End your turn now: the user approves it (or asks for changes) in their next message. Don't change anything until then.";

/** Refuses a change once the turn is meant to have ended. */
export function turnEnded(ctx: TurnContext): ToolOutcome | null {
  if (ctx.questionAsked) return { ok: false, error: WAITING };
  if (ctx.planPresented) return { ok: false, error: PLANNED };
  return null;
}

/**
 * The one door every change goes through, after its input is validated and before anything is
 * written: Auto goes ahead, Manual shows the request on an approval card and waits for the user.
 * Returns null to go ahead, or the refusal to hand back to the model.
 */
export async function confirmChange(
  ctx: TurnContext,
  request: ApprovalRequest,
): Promise<ToolOutcome | null> {
  const ended = turnEnded(ctx);
  if (ended) return ended;
  const decision = await ctx.confirm(request);
  if (decision.answer === 'yes' || decision.answer === 'yes_auto') return null;
  if (decision.answer === 'expired') {
    return {
      ok: false,
      error:
        'The user did not answer the approval in time, so nothing was done. Say what you were about to do and stop.',
    };
  }
  const feedback = decision.answer === 'no' ? decision.feedback : undefined;
  return {
    ok: false,
    error: feedback
      ? `The user said no, and wrote: "${feedback}". Nothing was done. Follow what they wrote.`
      : 'The user said no, so nothing was done. Ask what they would like instead, or carry on without it.',
  };
}
