# Phase 9 — Editor & Templates: implementation progress

Plan: `docs/plans/phase-9-editor-templates.md`
Branch: `codex/phase9-editor-templates`

## Chunks

- [x] Chunk 1 — Capability resolve + check-types plumbing
- [x] Chunk 2 — `POST /checks/test`
- [ ] Chunk 3 — `POST /blueprints/:id/validate`
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
- Found and worked around (test-only, no production fix) a latent bug in
  `ScriptSandboxService.evaluate()`: `Date.now() + this.config.sandboxTimeoutMs`
  string-concatenates instead of adding whenever `@nestjs/config`'s
  `ConfigService.get()` sees a raw `process.env.SANDBOX_TIMEOUT_MS` (a
  string, from `.env`) ahead of the typed value handed to a hand-built
  `ConfigService` in tests — `ConfigService.get()` checks
  `getFromProcessEnv` before `getFromInternalConfig`. This never surfaced
  before because no existing e2e spec exercises `ScriptSandboxService`
  (only unit tests, which don't load the e2e harness's `setup-e2e-env.ts`
  and its full `.env` load). The new `check-test.e2e.test.ts` needs a real
  script-check authoring-fault case, so it saves/deletes/restores
  `process.env.SANDBOX_TIMEOUT_MS` around its `beforeAll`/`afterAll` so the
  typed fake config wins, rather than patching `EngineConfig`/
  `ScriptSandboxService` (out of scope for this chunk).
- The task's suggested verification command (`vitest run src/artifact
  src/check test/e2e/check-test.e2e.test.ts`, no `-c` flag) silently drops
  the e2e file: the default `vitest.config.ts`'s `include` is
  `src/**/*.test.ts` only, so a `test/e2e/...` path passed on the CLI
  matches nothing and is skipped without error, not a failure. Ran the e2e
  file separately with `vitest run -c vitest.e2e.config.ts
  test/e2e/check-test.e2e.test.ts` (the same config `pnpm test:e2e` uses) —
  both runs passed.
