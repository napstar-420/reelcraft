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
  /** Phase 8: a v1 role selects one reusable channel Character. */
  characterId: z.string().optional(),
  /** Ordered, explicit subset of that Character's reference images. */
  referenceBlobIds: z.array(z.string()).optional(),
});
export type RoleDef = z.infer<typeof RoleDef>;

export const CreateBlueprintDto = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
});
export type CreateBlueprintDto = z.infer<typeof CreateBlueprintDto>;

export const UpdateBlueprintDto = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
  /** Archived blueprints are hidden from the channel's list until unarchived;
   * nothing else changes. */
  archived: z.boolean().optional(),
});
export type UpdateBlueprintDto = z.infer<typeof UpdateBlueprintDto>;

/** `blueprint.service.ts`'s row shape — the whole `blueprint` table row.
 * Moved here from `apps/web/src/api/client.ts` (A2) so the DTO carries the
 * new `description`/`tags` fields as the single source of truth. */
export const CreateBlueprintVersionDto = z.object({
  graph: z.array(StageDef),
  inputs: z.array(InputDef).default([]),
  roles: z.array(RoleDef).max(1).default([]),
  defaults: ConfigLayer.default({}),
  budget: z.object({ runCapUsd: z.number() }),
});
export type CreateBlueprintVersionDto = z.infer<typeof CreateBlueprintVersionDto>;

export const BlueprintDto = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  currentVersionId: z.string().nullable(),
  archived: z.boolean(),
  /** The canvas's autosaved unsaved edits; `null` when it matches the latest save. */
  workingDraft: CreateBlueprintVersionDto.nullable(),
  /** The saved version `workingDraft` was edited from (`null`: none existed yet,
   * or an older draft that never recorded one). The draft only belongs on the
   * canvas while this is the blueprint's `currentVersionId`. */
  workingDraftBaseVersionId: z.string().nullable(),
  runCount: z.number(),
  latestPosterBlobId: z.string().nullable(),
});
export type BlueprintDto = z.infer<typeof BlueprintDto>;

/** `baseVersionId` is the saved version the caller's draft is based on (`null`:
 * none saved yet). Required, so an out-of-date browser bundle gets a 400 rather
 * than overwriting. The write is refused with 409 `blueprint_changed` unless it
 * is still the blueprint's `currentVersionId`. */
export const SetWorkingDraftDto = z.object({
  workingDraft: CreateBlueprintVersionDto.nullable(),
  baseVersionId: z.string().nullable(),
});
export type SetWorkingDraftDto = z.infer<typeof SetWorkingDraftDto>;

/** Save bumps minor (1.5 → 1.6); "Bump version" bumps major (1.6 → 2.0). */
export const VersionBump = z.enum(['minor', 'major']);
export type VersionBump = z.infer<typeof VersionBump>;

/** `base`: the saved version the caller's edits are based on; the save is refused
 * with 409 `blueprint_changed` unless it is still current. Empty means no saved
 * version yet; omitted skips the check. */
export const CreateVersionQueryDto = z.object({
  bump: VersionBump.default('minor'),
  base: z.string().optional(),
});
export type CreateVersionQueryDto = z.infer<typeof CreateVersionQueryDto>;

export const BlueprintVersionDto = z.object({
  id: z.string(),
  blueprintId: z.string(),
  major: z.number().int(),
  minor: z.number().int(),
  graph: z.array(StageDef),
  inputs: z.array(InputDef),
  roles: z.array(RoleDef),
  defaults: ConfigLayer,
  budget: z.object({ runCapUsd: z.number() }),
  validation: z.array(ValidationIssue),
  runnable: z.boolean(),
  createdAt: z.string(),
  draft: z.boolean(),
  /** Real (not dry or draft) runs of this version; set by the versions list. */
  runCount: z.number().optional(),
});
export type BlueprintVersionDto = z.infer<typeof BlueprintVersionDto>;
