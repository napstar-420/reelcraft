/** Messages the app writes for the assistant when the user presses a button (such as "Fix with
 * assistant"). They name what they are about by id, because the chat is not tied to one page. */

/** What to tell the assistant about a stage that failed in a run. */
export function fixFailedStagePrompt(input: {
  runId: string;
  runHandle: string;
  blueprintName?: string | undefined;
  stageKey: string;
  stageLabel: string;
  reason: string | null;
}): string {
  const of = input.blueprintName ? ` of the blueprint “${input.blueprintName}”` : '';
  const why = input.reason ? ` The error was: ${input.reason}` : '';
  return `Run ${input.runHandle} (runId ${input.runId})${of} failed at the stage “${input.stageLabel}” (stageKey ${input.stageKey}).${why} Work out why, change the blueprint to fix it, and tell me what you changed.`;
}
