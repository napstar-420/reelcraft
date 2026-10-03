import type { EnabledWhen } from '@reelcraft/shared';

/** §16 — a stage with `enabledWhen` runs only when the named run input equals
 * the given value; otherwise the orchestrator marks it `skipped`. Text inputs
 * arrive as strings, so a number or boolean condition also matches its string
 * form ("3", "true"). A missing input never matches. */
export function isStageEnabled(
  enabledWhen: EnabledWhen | undefined,
  inputs: Record<string, unknown>,
): boolean {
  if (!enabledWhen) return true;
  const value = inputs[enabledWhen.input];
  if (value === undefined || value === null) return false;
  if (value === enabledWhen.equals) return true;
  return typeof value === 'string' && value.trim() === String(enabledWhen.equals);
}
