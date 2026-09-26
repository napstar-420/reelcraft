// Credential-shaped keys only: a bare /token/ would also hide `max_tokens`.
const SECRET_KEY =
  /^(token|secret|password|authorization|cookie|bearer)$|api.?key|access.?token|auth.?token|refresh.?token|client.?secret|private.?key|password|signing.?key/i;

const MAX_STRING = 20_000;
const MAX_DEPTH = 8;

/** Deep-copies `value` for logging: secret-keyed fields become
 * `[REDACTED]`, long strings are truncated, deep nesting is cut off. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated ${value.length - MAX_STRING} chars]`
      : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated: too deep]';
  if (Array.isArray(value)) return value.map((entry) => sanitizeForLog(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeForLog(entry, depth + 1),
    ]),
  );
}
