const MAX_DISPLAY_CHARS = 4000;

/** Tool results can be large (a whole draft); the chat keeps a bounded copy for display while
 * the model got the full result. */
export function truncateForDisplay(value: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return { truncated: true, preview: '(unserialisable result)' };
  }
  if (json === undefined || json.length <= MAX_DISPLAY_CHARS) return value;
  return { truncated: true, preview: json.slice(0, MAX_DISPLAY_CHARS) };
}

/** First line of the first message, trimmed, as the chat's title. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
