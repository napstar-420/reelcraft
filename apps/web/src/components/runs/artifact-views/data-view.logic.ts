export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'boolean';
}

/** The muted hint shown next to a collapsed object/array row. */
export function summarizeValue(value: unknown): string {
  const kind = jsonKind(value);
  if (kind === 'array') {
    const count = (value as unknown[]).length;
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }
  if (kind === 'object') {
    const count = Object.keys(value as object).length;
    return `${count} ${count === 1 ? 'key' : 'keys'}`;
  }
  return kind;
}

/** Short single-line strings sit beside their key; anything longer gets its
 * own wrapped paragraph so prose reads like prose, not an escaped literal. */
export function isInlineString(value: string): boolean {
  return value.length <= 60 && !value.includes('\n');
}

/** The dot path a context or memory-write `path` uses to reach this value —
 * the API's `getPath` splits on `.` only, so array items are addressed by
 * their index as a plain segment (`key_segments.0.purpose`), never `[0]`. */
export function childPath(parent: string, key: string | number): string {
  return parent ? `${parent}.${key}` : String(key);
}

/** Only the top two levels start open, so a large output shows its shape
 * first instead of every nested field at once. */
export function isOpenByDefault(depth: number): boolean {
  return depth < 2;
}
