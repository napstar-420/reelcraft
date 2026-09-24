import type { ZodType } from 'zod';
import type { ArtifactKind, CheckDef, JsonSchema } from '@reelcraft/shared';
import type { RefEnvelope } from '../artifact/binding-resolver.service';

export interface CheckArtifact {
  kind: ArtifactKind;
  data: unknown;
  probe?: unknown;
}

export interface CheckOutcome {
  pass: boolean;
  message?: string | undefined;
  details?: unknown;
}

export interface CheckResult extends CheckOutcome {
  /** 'schema' | the builtin key | the script's `name`. */
  name: string;
  kind: 'schema' | 'builtin' | 'script';
  /** 'artifact' = the output itself is wrong (worth a semantic retry).
   * 'authoring' = the check is broken (unknown key, bad params, script
   * won't compile/threw) — re-prompting the model can't fix that; chunk 5's
   * retry policy needs this distinction, this chunk just records it. Always
   * present when `pass` is false, always absent when `pass` is true. */
  fault?: 'artifact' | 'authoring';
}

export interface CheckRunInput {
  checks: CheckDef[];
  artifact: CheckArtifact;
  /** Index-parallel to `checks` — `{}` for builtins and refless scripts.
   * The CALLER resolves these via
   * `BindingResolverService.resolveRefEnvelopes()`; `CheckRunner` never
   * touches the DB. A length mismatch is a caller bug and throws. */
  resolvedRefs: Array<Record<string, RefEnvelope>>;
  /** Present iff `stage.output.kind === 'data'` — the §4.2 implicit check. */
  outputSchema?: JsonSchema;
}

export interface BuiltinCheck<P = unknown> {
  readonly key: string;
  /** Constructed locally, never wraps a `@reelcraft/shared` schema — the
   * cross-module zod hazard doesn't apply here (see README's Known
   * gotchas): this parses plain `unknown` (`CheckDef.params`), it never
   * builds a new combinator around an imported schema. */
  readonly params: ZodType<P>;
  /** Hand-kept parallel to `params` (no `zod-to-json-schema` dependency) so
   * `GET /check-types` can describe a builtin's params shape without
   * exposing zod internals. The two are not compiler-linked — see
   * `builtins.test.ts`'s drift-guard fixtures. */
  readonly paramsSchema: JsonSchema;
  readonly description: string;
  /** Pure, synchronous, no I/O (§9.1). Must not throw for artifact-shaped
   * problems (e.g. a missing `probe`) — return `{pass: false, message}`. */
  run(params: P, artifact: CheckArtifact): CheckOutcome;
}
