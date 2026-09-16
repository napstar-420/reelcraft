import type { ArtifactKind, JsonSchema } from '@reefcraft/shared';

/**
 * §16.4 — what a `Ref`/template binding actually resolves to, for the
 * compatibility walker. `data` carries the user-authored schema; the other
 * fixed kinds carry nothing extra (compatibility is nominal at the top
 * level for them). `literal` is a `{from:'const'}` value — it names no real
 * artifact, so it's kept distinct from `data` (mirrors
 * `RefEnvelope.kind`'s `'literal'` tag from chunk 2 — one vocabulary across
 * save time and run time). `unknown` always carries a `reason`: it only
 * appears when the caller (`binding-types.ts`) has ALSO emitted a
 * `ValidationIssue` explaining why (an unresolvable memory/asset/role ref)
 * — never a silent "couldn't tell, assume fine".
 */
export type SourceType =
  | { kind: 'data'; schema: JsonSchema }
  | { kind: Exclude<ArtifactKind, 'data'> }
  | { kind: 'literal'; value: unknown }
  | { kind: 'unknown'; reason: string };
