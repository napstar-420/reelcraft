import { z } from 'zod';
import { StageDef } from '../stage-def';
import { InputDef } from '../slots';
import { ConfigLayer } from '../config-layer';
import { ValidationIssue } from '../provider';

/**
 * §2.2/§18 — a Blueprint declares abstract roles, not concrete Characters;
 * v1 permits 0 or 1 role (§18.5). The design spec references RoleDef
 * (§3.4, §18.5) without spelling out its fields; Characters/roles are phase
 * 8 (out of scope here) — this is a minimal placeholder shaped like InputDef
 * so the `blueprint_version.roles` column has somewhere to live meanwhile.
 */
export const RoleDef = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
});
export type RoleDef = z.infer<typeof RoleDef>;

export const CreateBlueprintVersionDto = z.object({
  graph: z.array(StageDef),
  inputs: z.array(InputDef).default([]),
  roles: z.array(RoleDef).max(1).default([]),
  defaults: ConfigLayer.default({}),
  budget: z.object({ runCapUsd: z.number() }),
});
export type CreateBlueprintVersionDto = z.infer<typeof CreateBlueprintVersionDto>;

export const BlueprintVersionDto = z.object({
  id: z.string(),
  blueprintId: z.string(),
  version: z.number(),
  graph: z.array(StageDef),
  inputs: z.array(InputDef),
  roles: z.array(RoleDef),
  defaults: ConfigLayer,
  budget: z.object({ runCapUsd: z.number() }),
  validation: z.array(ValidationIssue),
  runnable: z.boolean(),
  sourceTemplateId: z.string().nullable(),
  createdAt: z.string(),
});
export type BlueprintVersionDto = z.infer<typeof BlueprintVersionDto>;
