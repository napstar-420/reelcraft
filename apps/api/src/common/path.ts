/** Dot-path lookup into an already-resolved JS value (e.g. an artifact's
 * `data`, or an already-bound `Ref` value) — no array-index bracket syntax,
 * no JSON-formatting fallback. This is deliberately NOT the same helper as
 * `prompt-template.ts`'s path walker: that one supports `list[0]` bracket
 * indexing and stringifies objects/arrays for template interpolation, which
 * are template-rendering concerns this one has no reason to carry. */
export function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}
