/** Every distinct storage `sourceKey` referenced anywhere inside resolved slot values. */
export function collectSourceKeys(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (typeof record.sourceKey === 'string') found.add(record.sourceKey);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...found];
}
