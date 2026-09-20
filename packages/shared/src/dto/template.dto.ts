import { z } from 'zod';
import { StageDef } from '../stage-def';
import { JsonSchema } from '../json-schema';
import { CheckDef } from '../check';
import { InputDef } from '../slots';

/** Chunk 4 — a template's `requires` is metadata about what a caller needs
 * before instantiating it (§20). `capabilities` is always server-derived at
 * save time for `blueprint`/`stage` kinds (Locked Decision 6) — whatever a
 * client sends here for those two kinds is ignored, not trusted. */
const TemplateRequires = z.object({
  capabilities: z.array(z.string()).default([]),
  inputs: z.array(InputDef).default([]),
});

const TemplateMetaFields = {
  name: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  requires: TemplateRequires.optional(),
};

/** Backs `POST /templates` (§20). A discriminated union on `kind` so each
 * branch's `body` is strongly typed to what that kind actually stores —
 * `z.discriminatedUnion` needs each branch to be its own top-level
 * `z.object`, so the shared meta fields are spread in rather than built via
 * `.extend()` on a common base. */
export const SaveTemplateDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blueprint'), body: z.array(StageDef), ...TemplateMetaFields }),
  z.object({ kind: z.literal('schema'), body: JsonSchema, ...TemplateMetaFields }),
  z.object({ kind: z.literal('check'), body: CheckDef, ...TemplateMetaFields }),
  z.object({ kind: z.literal('stage'), body: StageDef, ...TemplateMetaFields }),
]);
export type SaveTemplateDto = z.infer<typeof SaveTemplateDto>;

/** Backs `POST /templates/:id/instantiate` — only `kind: 'blueprint'`
 * templates need `channelId`/`runCapUsd` (§20); the other three kinds
 * ignore both server-side. Both stay optional here so a non-blueprint-kind
 * instantiate can still POST an empty body. */
export const InstantiateTemplateDto = z.object({
  channelId: z.string().min(1).optional(),
  runCapUsd: z.number().positive().optional(),
});
export type InstantiateTemplateDto = z.infer<typeof InstantiateTemplateDto>;
