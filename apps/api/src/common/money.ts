/**
 * §3.7/§3.12 — `numeric(12,4)` columns round-trip as strings through
 * drizzle-orm's postgres-js driver. Never `Number()` a money column ad hoc;
 * go through these helpers so precision loss is a decision, not an accident.
 */
export function toUsd(value: string): number {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) {
    throw new Error(`toUsd: not a numeric string: ${value}`);
  }
  return n;
}

export function fromUsd(value: number): string {
  return value.toFixed(4);
}
