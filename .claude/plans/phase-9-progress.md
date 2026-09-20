# Phase 9 — Editor & Templates: implementation progress

Plan: `docs/plans/phase-9-editor-templates.md`
Branch: `codex/phase9-editor-templates`

## Chunks

- [x] Chunk 1 — Capability resolve + check-types plumbing
- [x] Chunk 2 — `POST /checks/test`
- [x] Chunk 3 — `POST /blueprints/:id/validate`
- [x] Chunk 4 — Template library completion
- [x] Chunk 5 — Dry-run execution
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

### Chunk 4

- Implemented directly (no subagent) given the well-scoped, mostly-wiring
  nature of the chunk.
- `BlueprintValidatorService.validateStage()`'s per-check loop was split
  exactly as the task spec described: the context-free half (unknown
  builtin key / bad params / script-compiles) is now a public
  `validateCheckDef(check, checkBase): ValidationIssue[]`; the ref-resolution
  half (which needs `ctx`/`stageIndex`) stays inline in `validateStage`,
  calling `validateCheckDef` for its part. All 54 pre-existing
  `blueprint-validator.test.ts` tests pass unmodified after the refactor;
  added 5 new tests directly against `validateCheckDef` in isolation
  (unknown key, bad params, non-compiling script, passing builtin, passing
  script — none touching a graph/ctx).
- `TemplateModule` gained `JsonSchemaModule` + `CapabilityModule` as direct
  imports (confirmed non-circular per the task brief) so `TemplateService`
  can inject `SchemaValidatorService`/`CapabilityRegistry` directly, rather
  than reaching through `BlueprintModule` (which doesn't export those two).
  `BlueprintValidatorService` is now also injected into `TemplateService` —
  available for free since `BlueprintModule` already exports it and
  `TemplateModule` already imported `BlueprintModule`.
- Error-surfacing convention chosen after checking `capability.controller.ts`
  (`resolve` throws `BadRequestException(violations)`) and
  `channel/character.service.ts` (`BadRequestException` thrown directly from
  the service layer) and `run.service.ts` (`ConflictException` thrown
  directly from the service layer for "already exists"/state-conflict
  cases): `TemplateService.save()` throws `ConflictException` for a
  `(ownerId, kind, name)` collision (checked via a `SELECT` first, mirroring
  `BlueprintService.ensureBlueprint`'s existence-check pattern — never a
  caught unique-constraint error) and `BadRequestException(issues)` for a
  per-kind validation failure, both directly from the service, not the
  controller — consistent with the majority pattern found across the
  codebase's services.
- `TemplateService.instantiate()`'s final signature:
  `instantiate(templateId: string, channelId?: string, runCapUsd?: number)`.
  For `kind: 'blueprint'` it behaves exactly as before (verified by a
  regression test asserting the seeded "Hello Stage" template's instantiated
  graph/runnable/validation/requires match phase-1 behavior) and now throws
  `BadRequestException` if `channelId`/`runCapUsd` are omitted. For
  `kind: 'schema' | 'check' | 'stage'` it returns `{ body, requires }`
  straight from the latest `template_version` row with zero DB writes,
  ignoring `channelId`/`runCapUsd` entirely.
- `TemplateService.save()` returns `{ templateId, ...versionRow }` (the
  inserted `template_version` row, plus the generated `templateId`) rather
  than a bespoke shape — gives the caller the version id, `version` number,
  `body`, and derived `requires` in one response with no invented wrapper.
- `TemplateService.list(ownerId)` attaches each returned template's latest
  version's `requires` via a second query (`templateVersion` rows for the
  matched template ids, ordered `version DESC`, keeping only the first
  occurrence per `templateId` in JS) rather than a SQL `DISTINCT ON`/window
  function — simpler and adequate at this scale, matching the codebase's
  existing "load then reduce in JS" style used elsewhere (e.g.
  `BlueprintService.loadAssetsById`).
- `requires.capabilities` is always server-derived, never trusted from the
  client, for `blueprint` (`[...new Set(stage.capability for each stage)]`)
  and `stage` (`[stageDef.capability]`) kinds, per Locked Decision 6;
  `dto.requires?.inputs` is passed through unchanged (nothing to derive it
  from). `schema`/`check` kinds take `dto.requires` as-is (defaulting to
  `{capabilities: [], inputs: []}`), since neither has a `capability` field
  to derive from.
- `packages/shared/src/dto/template.dto.ts`'s `SaveTemplateDto` uses four
  independent `z.object({...})` branches (each spreading a shared
  `TemplateMetaFields` object) rather than `.extend()` on a common base —
  `.extend()` on a plain object produces a `ZodObject` that still
  type-checked fine with `z.discriminatedUnion` in practice here, but the
  four-independent-objects form was chosen anyway for clarity once each
  branch's `body` type differs structurally per kind.
- New `apps/api/test/e2e/template-library.e2e.test.ts` (11 tests, `buildTestApp`/
  `createTestDb` pattern) covers: round-trip save → list → instantiate for
  all 4 kinds; per-kind save-validation rejection with zero rows written for
  each kind; `list()` returning builtins + only the caller's own user
  templates (not another owner's); name-collision rejection; and the
  seeded "Hello Stage" blueprint-kind regression check. Full e2e suite
  (29 files / 170 tests) and full unit suite (42 files / 276 tests) both
  pass after this chunk, confirming no regressions from the `TemplateModule`
  DI graph change.

### Chunk 5

- Implemented directly (no subagent) — the design was fully locked in the
  task brief, so this was execution against a known plan rather than
  open-ended design work.
- Migration `apps/api/drizzle/0011_bitter_iron_patriot.sql` (drizzle-kit's
  auto-generated slug, left as generated) contains exactly one statement —
  `ALTER TABLE "run" ADD COLUMN "dry_run" boolean DEFAULT false NOT NULL;`
  — confirming no snapshot drift. Applied cleanly against the local dev DB
  (`pnpm db:migrate`) and picked up automatically by every e2e suite's
  per-test database (`createTestDb()` runs the full migration folder).
- The fake-provider override landed as a private `RunService.applyDryRunOverride(graph, resolvedConfig)`
  method (no new DI wiring — `RunService` already injects `CapabilityRegistry`
  for `assertTextStagesHaveMaxTokens`), called from `create()` only when
  `options?.dryRun` is set, strictly between `resolveRunConfig()` and
  `assertTextStagesHaveMaxTokens()`. It is a pure function: for each stage,
  looks up `capabilities.get(stage.capability).modality`; if the modality is
  in `{text: 'fake-text-1', image: 'fake-image-1', video: 'fake-video-1',
  audio: 'fake-audio-1'}` it replaces that stage's `ConfigLayer.model`
  wholesale (`params: {max_tokens: 256}` for text, `{}` otherwise); any other
  modality (`human`/`publish`/`compute`, and `media.analyze`'s `probe` path)
  is left completely untouched. Independently, any stage with a truthy
  `stage.qc` gets `ConfigLayer.qc.model` forced to
  `{provider:'fake', modelId:'fake-judge-1', params:{}}` while preserving any
  existing `qc.threshold`/`qc.capUsd` in the layer. `fake-judge-1` is not
  registered in `FakeProviderAdapter.listModels()` — confirmed safe by
  grepping existing tests (`config-resolver.e2e.test.ts`,
  `qc-runner.service.test.ts`, `blueprint-validator.test.ts`) which already
  use that exact modelId freely, since only `RunService.assertReferenceLimits`
  (role-consuming stages) ever calls `listModels()` to check a model's
  declared capabilities, never the QC judge path.
- `RunService.create(dto, options?: {dryRun?: boolean})` — the extra
  parameter is not part of `CreateRunDto` (kept DTO-free per the task's
  explicit instruction); `dryRun: options?.dryRun ?? false` is set on the
  inserted `run` row alongside the (possibly overridden) `resolvedConfig`.
- `RunService.startDryRun(blueprintId, version)` resolves `(blueprintId,
  version)` to `{channelId, blueprintVersionId}` via two lookups (`blueprint`
  by id, `blueprintVersion` by `(blueprintId, version)` pair — `create()`
  only takes a `blueprintVersionId`, so this pairing can't be done inside
  `create()` itself), throws `Error` with a `"...not found"` message for
  either miss, then calls `create({..., budgetCapUsd: 1}, {dryRun: true})`
  followed by `start()` verbatim. It deliberately does NOT re-check
  `runnable` itself — `create()` already throws `"BlueprintVersion <id>
  failed validation"` for a non-runnable version once handed that version's
  id, so re-checking would just duplicate that message under a different
  wording.
- Confirmed via `RunMutationService.withLockedRun` that `start()` does NOT
  flip `run.state` to `RUNNING` synchronously — only `run.orchestrate`'s
  `mark-running` step does, once the `run/started` event is actually
  processed. So `startDryRun()`'s return value (and the e2e test's first
  assertion) has `state: 'CREATED'`, not `'RUNNING'` — a detail easy to get
  wrong by analogy with a naive read of `start()`'s name.
- `RunService.list(includeDryRuns = false)` branches into two separate
  `.select().from(run)` calls (with/without `.where(eq(run.dryRun, false))`)
  rather than `.where(includeDryRuns ? undefined : eq(...))` — avoids
  fighting drizzle-orm 2.1's builder types for a conditional bare `.where()`.
  `RunController`'s `GET /runs` parses `?includeDryRuns=true` via
  `includeDryRuns === 'true'` (any other value, including absent, means
  `false`), consistent with this controller's existing `parseItemIndexQuery`-
  style manual query parsing.
- `BlueprintModule` now imports `RunModule` (confirmed non-circular by
  grep — nothing in `RunModule`'s transitive import graph references
  `BlueprintModule`); `BlueprintController` gets `RunService` injected
  alongside `BlueprintService` for the new `POST :id/versions/:v/dry-run`
  (`:v` parsed via Nest's built-in `ParseIntPipe`), which just calls
  `this.runs.startDryRun(id, version)`.
- New `apps/api/test/e2e/dry-run.e2e.test.ts` (3 tests, `phase2-acceptance.e2e.test.ts`'s
  nested-`InngestTestEngine` pattern — real `run.orchestrate` + `stage.execute`
  functions, `invoke-stage-*` mocked to run a real inner engine, never calling
  `StageRunnerService` directly) covers: (1) a two-stage graph — a text stage
  authored with no `model.params.max_tokens` plus an `image.generate` stage
  authored with a real-provider-shaped pin (`{provider:'openai', modelId:
  'some-real-model'}`) — driven to completion via `startDryRun()`, asserting
  the run's final `state` is `'COMPLETED'` (the exact `RunState` terminal-
  success literal, confirmed from `packages/shared/src/primitives.ts`),
  `run.dryRun === true` in the DB, and every `stage_attempt.job_handle.providerId`
  is `'fake'` (the field `FakeProviderAdapter.submit()` stamps on every
  `JobHandle`, already read elsewhere by `run-cancellation.service.ts`); (2)
  `list()`/`list(true)` exclude/include that dry run; (3) `startDryRun` on a
  nonexistent blueprint id or a nonexistent version number both throw with a
  `/not found/`-matching message; (4) the identical graph run for real via
  `create()`/no dry-run option throws `/max_tokens/`, proving the override
  never leaks into real-run validation and `assertTextStagesHaveMaxTokens`
  itself was never touched.
- Full verification: `pnpm --filter @reefcraft/shared build` clean;
  `pnpm --filter @reefcraft/api typecheck` clean; targeted unit suite
  (`src/run src/run-config`) 17 files / 73 tests passed; the new e2e file
  alone 3/3 passed; full e2e regression (`vitest.e2e.config.ts`, no filter)
  **30 files / 173 tests, 100% passed** — confirming `RunService.create()`'s
  hot-path change didn't regress any other suite; `pnpm lint` clean (one
  pre-existing unrelated warning in `media-output.e2e.test.ts`); `pnpm
  format:check` clean after one `prettier --write` pass on the new test file.
