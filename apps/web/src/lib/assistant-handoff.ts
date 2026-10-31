/** Hand-offs to the blueprint assistant. Today the assistant works inside a blueprint, so every
 * entry point outside the editor opens that blueprint with a message for the assistant, which
 * the editor sends once (`?ask=`). */

/** The editor URL that opens `blueprintId` and sends `message` to its assistant. */
export function askInBlueprintUrl(blueprintId: string, message: string): string {
  return `/blueprints/${blueprintId}/build?ask=${encodeURIComponent(message)}`;
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
