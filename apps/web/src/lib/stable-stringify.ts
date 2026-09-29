/** `JSON.stringify` with object keys sorted, so content that round-tripped
 * through Postgres `jsonb` (which reorders keys) compares equal to the
 * canvas's local copy. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
