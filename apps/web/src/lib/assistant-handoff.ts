/** Hand-offs to the blueprint assistant. Today the assistant works inside a blueprint, so every
 * entry point outside the editor opens that blueprint with a message for the assistant.
 *
 * The message travels in the router's navigation state, never the URL: only the app itself can
 * set that state, so a link someone sends you can't make the assistant act. A `?ask=` in the URL
 * only fills in the message box, and nothing is sent until you press Send. */

export type AskHandoff = { to: string; state: { ask: string } };

/** Opens `blueprintId` and sends `message` to its assistant: `navigate(h.to, { state: h.state })`. */
export function askInBlueprint(blueprintId: string, message: string): AskHandoff {
  return { to: `/blueprints/${blueprintId}/build`, state: { ask: message } };
}

/** The message an in-app hand-off carries in the navigation state, if any. */
export function handoffMessage(state: unknown): string | null {
  if (!state || typeof state !== 'object' || !('ask' in state)) return null;
  const ask = (state as { ask: unknown }).ask;
  return typeof ask === 'string' && ask.trim() ? ask : null;
}

/** A short blueprint name from what the user asked for: the first few words, capitalised. */
export function blueprintNameFromPrompt(prompt: string): string {
  const words = prompt
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length) return 'New blueprint';
  const name = words.join(' ');
  const capped = name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/** What to tell the assistant about a stage that failed in a run. */
export function fixFailedStagePrompt(input: {
  runHandle: string;
  stageLabel: string;
  reason: string | null;
}): string {
  const why = input.reason ? ` The error was: ${input.reason}` : '';
  return `Run ${input.runHandle} of this blueprint failed at the stage “${input.stageLabel}”.${why} Work out why, change the blueprint to fix it, and tell me what you changed.`;
}

/** What to tell the assistant when the user asks about a run from the run page. */
export function aboutRunPrompt(input: { runHandle: string; question: string }): string {
  return `About run ${input.runHandle} of this blueprint: ${input.question}`;
}
