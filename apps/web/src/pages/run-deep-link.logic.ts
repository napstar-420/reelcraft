import { canAnswerWaits } from '../lib/run-action-policy';

/** A notification links to `/runs/:id?review=<stage>` or `?input=<stage>`.
 * Only open what is still waiting: if the user already answered somewhere else,
 * the link just lands on the run page. */
export function deepLinkTarget(
  params: { review: string | null; input: string | null },
  run: {
    state: string;
    stageExecutions: Array<{
      stageKey: string;
      interaction?: string | null;
      waiting?: string | null;
    }>;
  },
): { review: string | null; input: string | null } {
  const waiting = (stageKey: string | null, kind: string, interaction?: string) =>
    canAnswerWaits(run.state) &&
    run.stageExecutions.some(
      (se) =>
        se.stageKey === stageKey &&
        se.waiting === kind &&
        (interaction === undefined || se.interaction === interaction),
    );
  return {
    review: params.review && waiting(params.review, 'approval') ? params.review : null,
    input: params.input && waiting(params.input, 'input', 'form') ? params.input : null,
  };
}
