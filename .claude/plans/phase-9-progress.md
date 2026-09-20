# Phase 9 — Editor & Templates: implementation progress

Plan: `docs/plans/phase-9-editor-templates.md`
Branch: `codex/phase9-editor-templates`

## Chunks

- [x] Chunk 1 — Capability resolve + check-types plumbing
- [x] Chunk 2 — `POST /checks/test`
- [x] Chunk 3 — `POST /blueprints/:id/validate`
- [ ] Chunk 4 — Template library completion
- [ ] Chunk 5 — Dry-run execution
- [ ] Chunk 6 — Frontend: capability config form + schema editor panel
- [ ] Chunk 7 — Frontend: check tester, template library, dry-run trigger

## Notes / deviations from plan

### Chunk 1

- The plan doc's claim that `MediaAnalyzeCapability` (or any capability)
  branches `slots()`/`allowedOutputs()` on config turned out to be false —
  every capability in the codebase ignores its config parameter for both
  methods today (confirmed by reading all impls under
  `apps/api/src/capability/impls/`). The unit test still verifies `resolve()`
  correctly delegates to `impl.slots(config)`/`impl.allowedOutputs(config)`
  across different configs; it just doesn't assert config-conditional output,
  since no capability currently produces one. `BuiltinCheck` did not
  previously have a `description` field — added one as part of this chunk
  since `GET /check-types` needs it.
- The first attempt at this chunk (a subagent) was killed mid-run by a
  transient network error right after finishing all the code changes and
  starting `pnpm --filter @reefcraft/api typecheck`. Its uncommitted changes
  were verified and one bug was fixed directly: the new
  `capability.controller.test.ts` called `image.slots(config)` /
  `audio.allowedOutputs(config)` on concrete `ImageGenerateCapability`/
  `AudioSpeechCapability` instances whose own method overrides declare zero
  parameters, which doesn't type-check when called with an argument even
  though JS would accept it at runtime. Fixed by casting each instance to
  `CapabilityImpl` first (`new ImageGenerateCapability(...) as unknown as
CapabilityImpl`), mirroring the exact cast `capability.registry.ts` already
  uses for the same underlying variance reason.

### Chunk 2

- `ArtifactService.getById()` throws a plain `NotFoundException` (not a
  hand-rolled `Error`) — checked several existing services first
  (`run-mutation.service.ts`, `run-action.service.ts`,
  `channel/character.service.ts`, `artifact/blob.controller.ts`) and every
  one throws `NotFoundException` directly from the service layer for a
  missing row, with no controller-side wrapping. Mirrored that exactly.
- `CheckTestService` (`apps/api/src/check/check-test.service.ts`) duplicates
  the small `prevStageKey`/`inputs`/`assetBindings`/`roleBindings` query
  `StageRunnerService.loadStageContext` (+ its private
  `loadRunInputs`/`loadAssetBindings`/`loadRoleBindings`) already does,
  rather than injecting `StageRunnerService`: `OrchestrationModule` (which
  owns `StageRunnerService`) already imports `CheckModule`, so importing the
  other direction would cycle the module graph. `CheckModule` already
  imports `DbModule`, so the duplicated query just uses the same injected
  `DRIZZLE` handle directly — no new module edge needed for that part.
  Added `ArtifactModule` as a new import to `CheckModule` for
  `ArtifactService`/`BindingResolverService` — confirmed `ArtifactModule`
  only imports `DbModule`/`StorageModule` (never `CheckModule`, directly or
  transitively), so this is not circular.
- Unlike `loadStageContext` (which throws if the stage isn't in the graph),
  `CheckTestService`'s lookup is lenient: an artifact produced by a
  synthetic `$input:<key>` producer key (a run input, not a stage)
  legitimately won't be found in the graph, and that's fine —
  `prevStageKey` is just left `undefined` in that case rather than
  throwing, since testing a check against an input artifact is a valid use
  case this chunk shouldn't block.
- Found and worked around (test-only, no production fix) a `SANDBOX_TIMEOUT_MS`
  string/number quirk in a hand-built test `ConfigService` — verified
  afterwards this is NOT a real production bug: `@nestjs/config`'s actual
  `ConfigService.get()` (checked directly in
  `node_modules/@nestjs/config/dist/config.service.js`) checks
  `getFromValidatedEnv` (the zod-`coerce`d value from `validateEnv`) BEFORE
  `getFromProcessEnv` (the raw string), and `SANDBOX_TIMEOUT_MS` has
  `z.coerce.number().default(100)` in `env.schema.ts`, so the real app
  always gets a coerced number. The quirk only appears in this suite's own
  hand-built `ConfigService`, whose fake internal config isn't wrapped in
  the `VALIDATED_ENV_PROPNAME` structure `getFromValidatedEnv` looks for, so
  it falls through to the raw `.env` string. `check-test.e2e.test.ts`
  saves/deletes/restores `process.env.SANDBOX_TIMEOUT_MS` around its
  `beforeAll`/`afterAll` as a test-harness workaround only.
- The task's suggested verification command (`vitest run src/artifact
src/check test/e2e/check-test.e2e.test.ts`, no `-c` flag) silently drops
  the e2e file: the default `vitest.config.ts`'s `include` is
  `src/**/*.test.ts` only, so a `test/e2e/...` path passed on the CLI
  matches nothing and is skipped without error, not a failure. Ran the e2e
  file separately with `vitest run -c vitest.e2e.config.ts
test/e2e/check-test.e2e.test.ts` (the same config `pnpm test:e2e` uses) —
  both runs passed.

### Chunk 3

- Implemented directly (no subagent) given the small, well-understood scope.
- `BlueprintService.createVersion()`'s pre-persist half (blueprint row load,
  `loadAssetsById`/`loadCharactersById`, `validator.validate()`,
  `validateReferenceLimits()`, `runnable` computation) extracted into a
  private `computeValidation()`; `createVersion()` calls it then persists as
  before (byte-identical behavior — verified via a regression e2e run of
  `phase2-acceptance.e2e.test.ts`), and a new public `validateOnly()` calls
  it without writing anything. `POST /blueprints/:id/validate` wraps
  `validateOnly` with `ZodValidationPipe(CreateBlueprintVersionDto)`, mirroring
  `POST :id/versions`'s existing pattern exactly.
- New `blueprint-validate.e2e.test.ts` proves `validateOnly` and
  `createVersion` compute byte-identical `issues`/`runnable` for both a
  valid and an invalid graph, and that `validateOnly` never changes the
  `blueprint_version` row count.
