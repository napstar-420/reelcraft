# PR Review: #19 — feat(editor): Phase 9 — Editor & Templates

**Reviewed**: 2026-09-21
**Author**: napstar-420
**Branch**: `codex/phase9-editor-templates` → `main`
**Decision**: APPROVE with comments (all findings fixed below before merge)

## Summary

Implements Phase 9 (Editor & Templates) end to end across 7 chunks, per `docs/plans/phase-9-editor-templates.md`. Backend work (capability resolve, check-types/check-test, blueprint validate, template library completion, dry-run execution) is well-scoped, reuses existing pure logic instead of duplicating it (`BlueprintValidatorService.validate()`/`.validateCheckDef()`, `CapabilityImpl.slots()`/`.allowedOutputs()`), and the dry-run design (a real `run` row forced onto the fake provider, driven through the unchanged async Inngest pipeline) is the right call over a bespoke synchronous path. Frontend work matches the deliberately thin scope (no visual graph canvas — split into a tracked Phase 9.5 follow-up). Test coverage is thorough: 276 unit tests, 173 e2e tests (including a real dry run driven through the actual Inngest functions to completion), all green, plus a live manual browser pass against real dev servers. No CRITICAL or HIGH findings — the issues below are consistency/robustness gaps worth a follow-up commit, not blockers.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **`CapabilityController.resolve()` doesn't catch `CapabilityRegistry.get()`'s throw for an unknown key** (`apps/api/src/capability/capability.controller.ts:39-50`). `this.capabilities.get(key)` throws a plain `Error` on a missing key, which NestJS's default filter turns into an opaque `500`. The same PR's `TemplateService.validateStageTemplate()` (`apps/api/src/template/template.service.ts:225-237`) hits the identical failure mode and explicitly wraps it in `try/catch` to produce a clean validation issue instead. Worth aligning `resolve()` to the same pattern (or a `NotFoundException`) so a typo'd capability key in the editor doesn't 500.

2. **`POST /templates/:id/instantiate` has no request-body validation** (`apps/api/src/template/template.controller.ts:29-32`). Every other endpoint touched or added by this PR (`POST /templates`, `POST /checks/test`, `POST /capabilities/:key/resolve`, `POST /blueprints/:id/validate`) uses `ZodValidationPipe`; this one still takes `@Body() body: { channelId?: string; runCapUsd?: number }` with no runtime check. A malformed `runCapUsd` (wrong type, negative, etc.) flows straight into `blueprintVersion.budget` via `TemplateService.instantiate()` → `BlueprintService.createVersion()` unchecked. Pre-existing gap (the original endpoint had the same issue), but this PR touched the signature and added Zod validation everywhere else, so it's the natural place to close it.

### LOW

3. **Three different "not found" conventions across the touched files.** `RunService.startDryRun()`'s blueprint/version lookups throw plain `Error` (`apps/api/src/run/run.service.ts:365,373`) → opaque `500`; `ArtifactService.getById()` (Chunk 2) throws `NotFoundException` → clean `404`; `TemplateService` mixes plain `Error` (`instantiate()`) with `NotFoundException`-style exceptions elsewhere. `startDryRun` matches `RunService.create()`'s own pre-existing convention, so it's locally consistent, but the PR as a whole would benefit from picking one convention.

4. **`startDryRun()`'s `budgetCapUsd: 1` is hardcoded** (`apps/api/src/run/run.service.ts:381`), not caller-configurable. A dry run of a blueprint with many stages or a heavily-iterating stage could hit `PAUSED_BUDGET` before completing even though the fake provider's per-call cost is near-zero, which would undercut the "prove the whole graph runs end to end" purpose for larger graphs. Low likelihood in practice, but there's no way to raise it from the API today.

5. **`TemplateService.save()`'s uniqueness check is a check-then-act race** (`apps/api/src/template/template.service.ts:134-149`). The `SELECT` existence check and the transactional `INSERT` aren't atomic; two concurrent saves of the same `(ownerId, kind, name)` could both pass the check, and the second `INSERT` would hit the DB's unique index directly, surfacing as a raw, uncaught Postgres error (`500`) instead of the intended `ConflictException` (`409`). Low impact given this is a documented single-user app with no real concurrent-write scenario today.

6. **`SaveTemplateDto.name` has no minimum length** (`packages/shared/src/dto/template.dto.ts:17`). An empty-string template name currently passes Zod validation and can be saved (the DB's `NOT NULL` constraint doesn't reject an empty string).

## Resolution

All 6 findings fixed before merge, at the user's request ("Let's fix all before merging"):

1. **Fixed** — `CapabilityController.resolve()` now catches the registry's throw and returns a clean `NotFoundException`. Regression test added in `capability.controller.test.ts`.
2. **Fixed** — `POST /templates/:id/instantiate` now validates its body via a new `InstantiateTemplateDto` (`packages/shared/src/dto/template.dto.ts`), wired through `ZodValidationPipe`. Unit tests added in `template.dto.test.ts`.
3. **Fixed** — `RunService.startDryRun()` and `TemplateService.instantiate()`'s "not found" throws now use `NotFoundException`, matching `ArtifactService.getById()`'s convention.
4. **Fixed** — `startDryRun()` now takes an optional `budgetCapUsd` parameter (default `1`, unchanged behavior when omitted), backed by a new `StartDryRunDto` on `POST /blueprints/:id/versions/:v/dry-run`. Threaded through the frontend `DryRunTrigger` component and `api.startDryRun` client function with a new "Budget cap (USD)" field. Unit tests added in `run.dto.test.ts`.
5. **Fixed** — `TemplateService.save()`'s transaction is now wrapped in a `try/catch` that converts a Postgres unique-violation (`23505`) into the same `ConflictException` the pre-check gives the common case, mirroring the existing `isUniqueViolation` pattern already used in `ledger.service.ts`/`stage-runner.service.ts`. Not unit-tested directly (mocking Drizzle's full chainable query builder plus `.transaction()` for this one branch was judged not worth the fragility it would add, and no other use of this codebase's `isUniqueViolation` pattern is unit-tested either) — covered indirectly by the existing e2e name-collision test continuing to pass through the new try/catch.
6. **Fixed** — `SaveTemplateDto.name` now has `.min(1)`. Unit test added in `template.dto.test.ts`.

Re-verified after fixes: 277/277 unit tests (api), 27/27 unit tests (shared, +8 new), 173/173 e2e tests, both builds clean, lint clean, format clean.

## Validation Results

| Check                             | Result                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type check (`shared`/`api`/`web`) | Pass                                                                                                                                                                           |
| Lint                              | Pass (1 pre-existing unrelated warning in `apps/api/test/e2e/media-output.e2e.test.ts`)                                                                                        |
| Unit tests                        | Pass — 276/276                                                                                                                                                                 |
| E2E tests                         | Pass — 173/173 (full regression, including `dry-run.e2e.test.ts` driving a real dry run through the actual Inngest functions to completion)                                    |
| Build (`api`/`web`)               | Pass                                                                                                                                                                           |
| Format                            | Pass                                                                                                                                                                           |
| Manual browser verification       | Pass — capability resolve, schema template save, check-test 404 handling, blueprint template instantiate, and a live dry run all exercised end to end against real dev servers |

## Files Reviewed

**Added**

- `apps/api/src/check/check-test.service.ts`, `check.controller.ts`, `check.controller.test.ts`
- `apps/api/src/db/schema/run.ts` (column addition) + `apps/api/drizzle/0011_bitter_iron_patriot.sql` + `meta/0011_snapshot.json` + `meta/_journal.json`
- `apps/api/test/e2e/blueprint-validate.e2e.test.ts`, `check-test.e2e.test.ts`, `dry-run.e2e.test.ts`, `template-library.e2e.test.ts`
- `apps/web/src/components/CapabilityConfigForm.tsx`, `CheckTesterPage.tsx`, `DryRunTrigger.tsx`, `SchemaEditor.tsx`, `TemplateLibraryPanel.tsx`
- `apps/web/src/pages/EditorPage.tsx`
- `packages/shared/src/dto/check.dto.ts`, `template.dto.ts`
- `.claude/launch.json`, `.claude/plans/phase-9-progress.md`, `docs/plans/phase-9-editor-templates.md`

**Modified**

- `apps/api/src/artifact/artifact.service.ts` (`getById`)
- `apps/api/src/blueprint/blueprint-validator.service.ts` (`validateCheckDef` extraction), `blueprint-validator.test.ts`, `blueprint.controller.ts`, `blueprint.module.ts`, `blueprint.service.ts` (`computeValidation`/`validateOnly`)
- `apps/api/src/capability/capability.controller.ts`, `capability.controller.test.ts`, `capability.module.ts`
- `apps/api/src/check/builtins/*.ts` (9 files — `paramsSchema` + `description` added), `check.module.ts`, `check.types.ts`
- `apps/api/src/run/run.controller.ts`, `run.service.ts` (`create` options, `startDryRun`, `applyDryRunOverride`, `list`)
- `apps/api/src/template/template.controller.ts`, `template.module.ts`, `template.service.ts` (rewritten: `list`/`save`/`listVersions`/`instantiate`)
- `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/pages/BlueprintsPage.tsx`
- `docs/build-progress.md`
- `packages/shared/src/dto/capability.dto.ts`, `dto/index.ts`
