# Phase 7 — Implementation progress

Tracks execution of `docs/plans/phase-7-iteration.md`, chunk by chunk.
Updated as each chunk lands; not part of the shipped plan doc.

- [x] Branch `codex/phase7-iteration` created off `main`
- [x] Plan doc committed
- [x] Chunk 1 — Types, config layer, and validator completion (commit e60c7ce)
- [x] Chunk 2 — Run Memory indexed groups (commit db96a30)
- [x] Chunk 3 — Binding resolver: item, prevItem, prev+alignWith, derived frames (commit 4159723)
- [x] Chunk 4 — Orchestration: the per-item loop (commit d20c8fd)
- [ ] Chunk 5 — Item-level invalidation
- [ ] Chunk 6 — Item-mode approval
- [ ] Chunk 7 — Acceptance scenario, docs, hardening
- [ ] Full monorepo typecheck/lint/test green
- [ ] PR opened against `main`

## Notes / deviations from plan

- Chunk 1: found + fixed a pre-existing repo issue unrelated to Phase 7 —
  migrations 0007-0009 were missing their `drizzle/meta/*_snapshot.json`
  files, so `db:generate` re-diffed from 0006 and bundled their DDL into the
  new migration. Trimmed the generated SQL to just `stage_item.failure`; the
  regenerated 0010 snapshot now repairs the drift going forward.
- Chunk 1: refined `checkIterate` beyond the plan's sketch — `{from:'const'}`
  as `iterate.over` is legal per §14.3 (just unalignable), so a const whose
  value is an actual array must not hit the generic array-narrowing error.
  Added a test for both the pass and fail case.
- Chunk 1: all 6 open-decision resolutions from the plan doc are implemented
  as written (strict prevItem, reserved groupKey, "not yet supported" media
  message, new prev-into-iterating error, item retries on reject, last-item
  outputArtifactId — the last two land in Chunks 4/6).
- Chunk 3: `fetchPrevArtifact(ctx, ref?)` takes the whole `{from:'prev'}` ref
  (not a bare `itemIndex` override as the plan's sketch showed) so it can
  read `ref.alignWith` itself — same effect, slightly different signature.
  Added a `valueForArtifactRow(row, path, handle)` private helper shared by
  `'prev'` and `'prevItem'` (kind dispatch: media manifest / blob manifest /
  unwrapped data) instead of duplicating that branch inline in each case, as
  the plan's sketch did.
- Chunk 3: `DerivedFrameService` needs `ownerId`/`channelId` for
  `objectKey.derivedFrame(...)`, and the artifact row carries neither —
  resolved by joining `run`→`channel` inside the same transaction, mirroring
  the exact pattern `StageRunnerService.fetchAndFinalize` already uses for
  `writeRawResponse`/`MediaArtifactService.persist`. No new convention
  introduced.
- Chunk 3: the actual ffmpeg call is behind a `protected runFfmpeg(args)`
  method on `DerivedFrameService` rather than a constructor-injected
  execFile wrapper — lets unit/e2e tests subclass and override it (writing a
  small fake buffer instead of shelling out) without adding a new DI token
  the rest of the app never needs.
- Chunk 3: `DerivedFrameService`'s tests are DB-backed
  (`apps/api/test/e2e/derived-frame.e2e.test.ts`, real Postgres + the
  existing `MemoryStorageAdapter` test double) rather than fully-mocked
  Drizzle-chain unit tests — this repo has no precedent for mocking
  `db.transaction()`/`SELECT ... FOR UPDATE` chains, and a real Postgres
  transaction is a strictly more faithful test of the row-lock race guard
  than a hand-mocked one. ffmpeg itself is still stubbed (no real binary
  invoked), keeping the suite fast and CI-safe per the plan's intent.
- Chunk 3: the concurrency/"race" test is the lighter form the plan
  explicitly allows — a "winning" concurrent write is inserted directly via
  a second raw DB update before calling `extract()` with a stale (pre-race)
  row snapshot, asserting the row-lock re-check picks it up without a
  second ffmpeg call, rather than orchestrating two real concurrent
  transactions.
- Chunk 3: `stage-runner.service.ts` plumbing is intentionally inert this
  chunk — `resolveBindings` gained an `itemIndex?` param and
  `StageAttemptContext` gained an optional `itemIndex` field, threaded into
  `BindingScope`/`ExecCtx`, but every call site today still leaves it
  `undefined` (no per-item loop exists yet — that's Chunk 4). The
  script-check `resolveRefEnvelopes` call site in `fetchAndFinalize` was
  also given `stageKey`/`itemIndex` for consistency, but not
  `iterateOverValue` — populating that for check refs needs Chunk 4's
  `resolveIterateCount`, not just plumbing.
- Chunk 3: `bindings.e2e.test.ts`'s old "throws naming phase 7/8 for
  item/prevItem/role" stub test was replaced — `item`/`prevItem` no longer
  throw a stub error, so the test now only covers `role` (still phase 8),
  with real item/prevItem/alignWith coverage added as a new nested
  `describe` block in the same file.
- Chunk 4: engineering judgment call — extracted the ~150-line attempt
  loop out of `stage-execute.fn.ts` into a new shared
  `orchestration/functions/stage-attempt-loop.ts` (`runStageAttemptLoop`),
  called by both `stage.execute` (non-iterating) and the new
  `stage.execute.item`, rather than the plan's literal "straight copy"
  sketch. Safe specifically because each item's attempt loop is its own
  Inngest function invocation with its own step history — step ids never
  need per-item disambiguation, so the shared helper's step-id scheme is
  byte-for-byte identical for both callers; only the retry-limit source
  and an optional `itemIndex`/`stageItemId` differ.
- Chunk 4: `StageRunnerService.beginAttempt`/`countSemanticAttemptsUsed`/
  `countInfraAttemptsUsed`/`loadCritiqueLog` gained an optional
  `stageItemId` parameter that switches their `isNull(stageAttempt.
  stageItemId)` predicate to `eq(..., stageItemId)`, per the plan's stated
  preference over duplicating each method.
- Chunk 4: found and fixed two pre-existing gaps left inert by Chunk 3's
  own notes: (1) `buildExecCtx` never actually passed `ctx.itemIndex` into
  `idempotencyKey(ctx, itemIndex)`, so every item's idempotency key would
  have collided on `itemIndex ?? 0`; (2) `fetchAndFinalize`'s call to
  `ArtifactService.recordAttemptArtifact` never passed `itemIndex` at all,
  so every item's artifact would have been written with `item_index IS
  NULL` — the second item to finalize would hit the
  `artifact_active_uq` unique constraint. Both are now wired through
  `ctx.itemIndex`.
- Chunk 4: `ResolvedBindings` gained an optional `iterateOverValue` field
  (set by `resolveAll`) so `fetchAndFinalize`'s check-ref resolution scope
  can carry it without re-resolving `stage.iterate.over` a second time —
  this is what makes a script check's `{from:'item'}` ref actually work
  for real (Chunk 3 plumbed `stageKey`/`itemIndex` into that scope but
  explicitly left `iterateOverValue` for this chunk).
- Chunk 4: `resolveIterateCount`'s §14.3 runtime alignment assertion is
  implemented as a lighter-weight canonicalization than the validator's
  own (`binding-types.ts`'s `canonicalize`, which needs a full
  `ValidationContext` for `memory` refs' writer resolution) — it compares
  `(producerKey, path)` pairs computed directly from the graph in hand,
  treating a `{from:'memory', key}` ref's canonical producer as
  `memory:<key>` rather than resolving to the actual writer stage. This
  is sufficient for equality-checking two iterate.over Refs (the only use
  here) without needing a `ValidationContext` at run time; it is not
  reused by/for the validator itself.
- Chunk 4: test scoping — item-mode approval (`approval.mode:'item'`) is
  untested this chunk, per the task's explicit scope boundary (Chunk 6's
  job); `fetchAndFinalize`'s existing `approval.mode !== 'stage'` throw
  is left in place with an added TODO comment. The Inngest-driven e2e
  test mocks `run-item-*` `step.invoke` calls (mirroring
  `run-orchestrate-inngest.e2e.test.ts`'s established mocking of
  `invoke-stage-*`) rather than running a live Inngest dev server,
  because `step.invoke`'s `InvokeFunction` op is an async dispatch-and-
  wait against a real server that `InngestTestEngine` cannot resolve
  in-process — confirmed by reading the installed `inngest`/`@inngest/test`
  source, the same verification basis that file's own docstring cites. A
  separate suite in the same file drives `stage.execute.item`'s own
  attempt loop with zero step mocking, so the real per-item step chain
  (submit/poll/fetch/check/finalize) is still exercised end to end.
