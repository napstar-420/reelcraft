/** The tokens a turn may read before the chat continues in a fresh session (as the API). */
export const CARRY_OVER_INPUT_TOKENS = 150_000;

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** How full the conversation is, 0-100, from what the latest turn read; null before any turn. */
export function fullness(lastInputTokens: number | null): number | null {
  if (lastInputTokens === null) return null;
  return Math.min(100, Math.round((lastInputTokens / CARRY_OVER_INPUT_TOKENS) * 100));
}
