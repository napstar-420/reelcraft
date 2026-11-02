/** A chat whose tools are out of date continues in a fresh provider session that starts from a
 * summary. A long chat never does: Codex and Claude manage their own context, and Reelcraft only
 * records usage. */

/** The most characters of a summary carried into the new session. */
export const SUMMARY_CHARS = 8_000;

export type CarryOverReason = 'updated';

/** Why the next message should start a fresh session, or null when it can continue as it is. */
export function carryOverReason(input: { stale: boolean }): CarryOverReason | null {
  return input.stale ? 'updated' : null;
}

/** What the old session is asked for: a hand-off for the model that continues the chat. */
export const SUMMARY_PROMPT = `<reelcraft_context>This chat is moving to a fresh session (Reelcraft was updated). Do not call any tool. Write a hand-off for the assistant that continues it, in at most 600 words:
- what the user wants overall, and their preferences and decisions so far;
- what you did: blueprints, versions, runs, files and ids involved (keep every id exactly);
- what is in progress or waiting (runs being watched, goals, questions, approvals);
- what the user asked for most recently and what should happen next.
Write only the hand-off.</reelcraft_context>`;

/** When the old session can't write the hand-off: the conversation's own words, newest last. */
export function fallbackSummary(
  exchanges: Array<{ role: 'user' | 'assistant'; text: string }>,
): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of [...exchanges].reverse()) {
    const line = `${e.role === 'user' ? 'User' : 'Assistant'}: ${e.text.trim().slice(0, 1200)}`;
    if (used + line.length > SUMMARY_CHARS) break;
    lines.unshift(line);
    used += line.length;
  }
  return `The earlier conversation (newest last; the session that had it could not summarise it):\n${lines.join('\n')}`;
}

/** The first message of the fresh session: the hand-off, then the user's message. */
export function withSummary(summary: string, text: string): string {
  return `<earlier_conversation_summary>\n${summary.slice(0, SUMMARY_CHARS)}\n</earlier_conversation_summary>\n\n${text}`;
}
