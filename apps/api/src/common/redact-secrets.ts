const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|secret|token|password)/i;

/**
 * §23 — applied to any provider request before persistence to `raw/*.json`,
 * and to any log line that may carry a presigned URL (§21.3, bearer tokens).
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/(X-Amz-Signature=)[^&\s]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}
