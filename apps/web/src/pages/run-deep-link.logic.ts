/** A notification links to `/runs/:id?review=<stage>` or `?input=<stage>`.
 * Only open what is still waiting: if the user already answered somewhere else,
 * the link just lands on the run page. */
export function deepLinkTarget(
  params: { review: string | null; input: string | null },
  run: {
    state: string;
    cursorStageKey: string | null;
    stageExecutions: Array<{ stageKey: string; interaction?: string | null }>;
  },
): { review: string | null; input: string | null } {
  const review =
    params.review && run.state === 'PAUSED_APPROVAL' && run.cursorStageKey === params.review
      ? params.review
      : null;
  const input =
    params.input &&
    run.state === 'PAUSED_INPUT' &&
    run.cursorStageKey === params.input &&
    run.stageExecutions.some((se) => se.stageKey === params.input && se.interaction === 'form')
      ? params.input
      : null;
  return { review, input };
}
