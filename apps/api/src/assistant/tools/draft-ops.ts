import { z } from 'zod';
import type { CreateBlueprintVersionDto } from '@reelcraft/shared';

export const DRAFT_OPS = [
  'remove_stage',
  'add_stage',
  'replace_stage',
  'update_stage',
  'set_draft_field',
] as const;

/** The draft fields `set_draft_field` can replace: everything except the stages. */
export const DRAFT_FIELDS = [
  'inputs',
  'roles',
  'defaults',
  'budget',
  'execution',
  'presentation',
] as const;

const key = z.string().min(1);

/** One small edit to a draft. `stage` is checked by the draft's own parse afterwards, so a
 * made-up field comes back as the same "unknown stage field" issue `propose_draft` gives. */
export const DraftOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('remove_stage'), key }).strict(),
  z.object({ op: z.literal('add_stage'), stage: z.unknown(), after: key.optional() }).strict(),
  z.object({ op: z.literal('replace_stage'), key, stage: z.unknown() }).strict(),
  z
    .object({
      op: z.literal('update_stage'),
      key,
      set: z.record(z.string(), z.unknown()).optional(),
      unset: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal('set_draft_field'), field: z.enum(DRAFT_FIELDS), value: z.unknown() })
    .strict(),
]);
export type DraftOp = z.infer<typeof DraftOp>;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Applies `ops` in order to a copy of `draft`. All or nothing: the first op that can't be
 * applied returns an error naming it and the stages that do exist. The result is not yet
 * validated; the caller parses it like any proposed draft. */
export function applyDraftOps(
  draft: CreateBlueprintVersionDto,
  ops: DraftOp[],
): { ok: true; draft: unknown } | { ok: false; error: string } {
  const next = structuredClone(draft) as unknown as Json & { graph: Json[] };
  const fail = (index: number, op: DraftOp, why: string) => ({
    ok: false as const,
    error: `Edit ${index + 1} (${op.op}${'key' in op ? ` "${op.key}"` : ''}) failed: ${why} Nothing was changed. Stages: ${
      next.graph.map((s) => s.key).join(', ') || '(none)'
    }.`,
  });
  const indexOf = (k: string) => next.graph.findIndex((s) => s.key === k);

  for (const [i, op] of ops.entries()) {
    switch (op.op) {
      case 'remove_stage': {
        const at = indexOf(op.key);
        if (at < 0) return fail(i, op, 'there is no stage with that key.');
        next.graph.splice(at, 1);
        // the canvas keeps a position (and a branch name) per stage key
        const presentation = next.presentation as
          { positions?: Json; branchNames?: Json } | undefined;
        if (presentation?.positions) delete presentation.positions[op.key];
        if (presentation?.branchNames) delete presentation.branchNames[op.key];
        break;
      }
      case 'add_stage': {
        if (!isObject(op.stage) || typeof op.stage.key !== 'string' || !op.stage.key)
          return fail(i, op, 'the stage needs a "key".');
        if (indexOf(op.stage.key) >= 0)
          return fail(i, op, `a stage "${op.stage.key}" already exists; keys are unique.`);
        let at = next.graph.length;
        if (op.after !== undefined) {
          const after = indexOf(op.after);
          if (after < 0) return fail(i, op, `"after" names no stage ("${op.after}").`);
          at = after + 1;
        }
        next.graph.splice(at, 0, op.stage);
        break;
      }
      case 'replace_stage': {
        const at = indexOf(op.key);
        if (at < 0) return fail(i, op, 'there is no stage with that key.');
        if (!isObject(op.stage) || op.stage.key !== op.key)
          return fail(i, op, 'the new stage must be an object with the same "key".');
        next.graph[at] = op.stage;
        break;
      }
      case 'update_stage': {
        const at = indexOf(op.key);
        if (at < 0) return fail(i, op, 'there is no stage with that key.');
        const fields = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])];
        if (fields.length === 0) return fail(i, op, 'give at least one field in set or unset.');
        if (fields.includes('key'))
          return fail(i, op, "a stage's key can't be changed; remove it and add a new stage.");
        const stage = { ...next.graph[at]!, ...op.set };
        for (const field of op.unset ?? []) delete stage[field];
        next.graph[at] = stage;
        break;
      }
      case 'set_draft_field':
        if (op.value === null || op.value === undefined) delete next[op.field];
        else next[op.field] = op.value;
        break;
    }
  }
  return { ok: true, draft: next };
}
