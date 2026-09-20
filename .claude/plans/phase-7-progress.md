# Phase 7 — Implementation progress

Tracks execution of `docs/plans/phase-7-iteration.md`, chunk by chunk.
Updated as each chunk lands; not part of the shipped plan doc.

- [x] Branch `codex/phase7-iteration` created off `main`
- [x] Plan doc committed
- [x] Chunk 1 — Types, config layer, and validator completion (commit e60c7ce)
- [x] Chunk 2 — Run Memory indexed groups (commit db96a30)
- [x] Chunk 3 — Binding resolver: item, prevItem, prev+alignWith, derived frames (commit 4159723)
- [x] Chunk 4 — Orchestration: the per-item loop (commit d20c8fd)
- [x] Chunk 5 — Item-level invalidation (commit b1f86a8)
- [x] Chunk 6 — Item-mode approval (commit 40f0373)
- [x] Chunk 7 — Acceptance scenario, docs, hardening (commit 3b4e520)
- [x] Full monorepo typecheck/lint/test green
- [x] PR opened against `main` (#17: https://github.com/napstar-420/reelcraft/pull/17)

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
- Chunk 5: node-keying/type design — `computeInvalidationClosure` moved
  from one node per `stageKey` to one node per `(stageKey, itemIndex |
undefined)`. A non-iterating stage keeps exactly one node (`itemIndex`
  undefined) so the graph degenerates to byte-identical prior behavior
  when nothing iterates — all 4 pre-existing tests pass with zero
  assertion changes. `InvalidationClosure.affectedStageKeys` /
  `affectedExecutionIds` deliberately KEPT their exact prior "one entry
  per affected stage" semantics (needed because `run-action.service.ts`'s
  `toApiPreview` zips them together by array index) rather than growing
  to one-entry-per-item as the plan's own sketch suggested;
  `affectedArtifactIds` did grow to the union of every invalid node's own
  artifact (a `stage_execution` can now map to several artifacts across
  its items), and a new `affectedItems: AffectedItem[]` field carries the
  item-precise `(stageKey, itemIndex, artifactId)` triples `apply()`
  actually needs. `InvalidationSeed.items?: Array<{stageKey, itemIndex}>`
  is added and the algorithm fully supports it, but per the task's scope
  boundary none of the 5 existing callers (`run-input.service.ts`,
  `human-action.service.ts`, `run.controller.ts`, `artifact-edit.service.ts`,
  `run-action.service.ts`) were changed to produce it — that's Chunk 6's
  job.
- Chunk 5: `{from:'prev', alignWith:'item'}`'s pointwise invalidation
  needed no special-case code at all — it falls out of the existing
  artifactId-based dependency check for free, since an aligned read's
  recorded provenance already carries the specific upstream item's own
  artifactId (not the stage's convenience pointer), so seeding that one
  item's artifact into `affectedArtifacts` naturally only trips the
  aligned downstream item that actually read it.
- Chunk 5: found and fixed two pre-existing integration gaps while wiring
  the DB-facing side, both required for the new e2e test to pass at all:
  (1) `run-orchestrate.fn.ts`'s per-stage resume skip (`state === 'passed'
-> continue`) predates iteration and doesn't know a `stage_execution`
  can stay `'passed'` while some of its own `stage_item` rows are
  `'stale'` (item-level invalidation's whole point) — it now also loads
  which iterating executions still have non-`'passed'` items and folds
  that into the skip condition; `stage.execute`'s own outer per-item loop
  (Chunk 4) already re-checks each item's state once re-entered, so
  nothing else needed to change. (2) `StageRunnerService.fetchAndFinalize`
  never threaded `ctx.itemIndex` into `MemoryService.buildWriteCallback`,
  so ANY iterating stage declaring `writes` was silently writing every
  item to the same bare (non-suffixed) memory key instead of `key#i` —
  Chunk 2's indexed-group writes were never actually reachable end to end
  before this fix. Fixed by threading `ctx.itemIndex` through.
- Chunk 5: `run-action.service.ts`'s `toApiPreview` zipped
  `affectedStageKeys[i]`/`affectedArtifactIds[i]`/`costs.find(stageKey)`
  by array index/first-match, which silently mis-attributes data once a
  single stage can own multiple artifacts/cost rows (an iterating stage
  with several invalid items). Fixed to group `affectedItems`/`costs` by
  `stageKey` instead (summing per-stage cost) — a minimal, scoped fix
  forced by the type change, not new behavior; `affectedStageKeys`/
  `affectedExecutionIds` are still zipped together since that pairing's
  semantics didn't change.
- Chunk 5: new pure tests in `invalidation-closure.test.ts` (item-
  independence, same-stage cascade, `alignWith:'item'` pointwise, memory
  group read with a "no false positive on an unrelated key" check,
  whole-stage seed) directly encode the propagation rules; a new
  `apps/api/test/e2e/invalidation-items.e2e.test.ts` drives a real 4-item
  iterating stage to completion through `StageRunnerService` (no Inngest,
  matching Chunk 4's own e2e style) and exercises `InvalidationService`
  end to end: retrying item 1 stales only `stage_item` index 1 (not its
  siblings), tombstones only `broll#1`'s memory row, leaves `stage_execution
.state` at `'passed'`, and confirms `itemState()` would no longer skip
  that item on a re-entered `stage.execute`.
- Chunk 6: `StageRunnerService.fetchAndFinalize`'s approval branch was
  restructured (not just extended) — the `stage_attempt` "awaiting_approval"
  update now happens once, before the stage-mode/item-mode split, instead of
  being duplicated inside each branch; the resulting DB writes for stage-mode
  are byte-identical to before, just expressed without repeating that one
  statement. The item-mode branch writes `stage_item.state =
'awaiting_approval'` and opens the `humanWait` with `stageItemId` set,
  deliberately leaving `stage_execution` untouched (still `'running'`) —
  the outer per-item loop's own `finishIteratingStage` is the only thing
  that ever flips it to `'passed'`.
- Chunk 6: `HumanActionService.approve`/`.reject` gained a shared private
  `resolveOpenItem(executor, stageExecutionId, itemIndex?)` helper: it loads
  the one `stage_item` currently `'awaiting_approval'` for an execution
  (iteration is strictly sequential, so there's ever at most one) and, when
  the caller supplied an `itemIndex`, verifies it matches rather than
  trusting it blindly — satisfying the plan's "server-side resolution,
  client itemIndex as a confirmation/race-safety check" requirement without
  needing the controller or DTO to change beyond threading `itemIndex`
  through (both already had the field/plumbing from earlier chunks).
- Chunk 6: `approveInTransaction` branches on `stage.approval?.mode ===
'item'` at its very top and calls a new private `approveItemInTransaction`
  for that case; everything below is the original stage-mode body,
  unchanged. `pendingAttempt`, `requireOpenWait`, and `retryDebits` (the
  "own" count only — see below) each gained an optional trailing
  `stageItemId` parameter that switches their `stageItemId IS NULL`
  predicate to an exact match; every existing call site keeps passing
  nothing extra, so stage-mode behavior is provably unchanged (confirmed by
  the full stage-mode approve/reject e2e and unit coverage passing
  unmodified).
- Chunk 6: `reject()`'s routed-rejection item-scoping question (an open
  design point in the plan) was resolved as: item-scoping only applies when
  BOTH (a) the rejected stage is itself item-mode, and (b) the retry TARGET
  stage also declares `iterate` — in which case the same item index is
  assumed to carry over pointwise (the same assumption `{from:'prev',
alignWith:'item'}` already makes elsewhere in this phase). A routed
  rejection to a non-iterating earlier stage (the case this chunk's tests
  cover) stays a whole-stage `{stageKeys:[...]}` seed. The rejected item
  itself is always additionally force-included in the seed's `items` array
  (`{stageKey, itemIndex}`), mirroring what `forcedStageKeys:[stageKey]`
  already does for stage-mode — `computeInvalidationClosure`'s dedup-by-key
  `markInvalid`/`markWholeStage` makes this safe to include unconditionally
  even when it overlaps the target seed.
- Chunk 6: `retryDebits`'s "routed" (cross-stage critique) count deliberately
  stays stage-wide even for an item-mode rejection — `critiqueTargetStageKey`
  names a stage, not an item, and no other part of the schema carries an
  item dimension for a routed rejection, so inventing one here would be
  unsupported by anything else in the phase. Only the "own" count (this
  stage/item's own consumed retries) is scoped by `stageItemId`. The
  `exhausted` check switches to `effective.iterate!.itemRetryLimit` exactly
  when the retry TARGET stage iterates, independent of whether the
  REJECTED stage does (matters for the routed-to-a-different-iterating-stage
  edge case, though this chunk's own tests only exercise the non-iterating
  routed target).
- Chunk 6: on item-mode exhaustion, only the target's own `stage_item.state`
  is set to `'failed'` (never `stage_execution`) — sibling items are left
  completely alone, matching §14.1's "no continue-and-isolate" read as
  "the item still fails the run" rather than "the whole stage's other items
  are discarded too." The run itself is still marked `FAILED` exactly as
  stage-mode does today; that part is unconditional and unchanged.
- Chunk 6: the existing `human-action.service.test.ts` wiring test (asserts
  `approve()` delegates into `approveInTransaction` with the right args) was
  updated to expect the new trailing `itemIndex` argument (`undefined` when
  omitted) — a mechanical adjustment to the new signature, not a weakened
  assertion; it still checks the exact `tx`/`runId`/`stageKey`/`lockedRun`
  values.
- Chunk 6: new `apps/api/test/e2e/item-approval.e2e.test.ts` (4 tests, no
  Inngest — same direct-`StageRunnerService`-call style as Chunk 4/5's own
  suites), covering: (1) the pause lands on `stage_item`, not
  `stage_execution`, before item 1 ever gets a `stage_attempt` row, with a
  ledger-based cost-containment assertion (total confirmed `'actual'` spend
  for the stage at the pause point equals exactly item 0's own cost); (2)
  approving with `itemIndex` omitted resolves the open item server-side and
  resumes exactly at item 1 (a real new `stage_attempt` row for item 1,
  item 0 not re-invoked); (3) rejecting item 0 with the default (no
  `onReject`) retry target re-submits item 0 alone (new attempt, same
  `stageItemId`), leaving item 1's zero `stage_attempt` rows untouched; (4)
  a routed rejection to an earlier non-iterating `style` stage seeds
  `style` whole-stage AND forces the rejected `broll` item itself invalid,
  without touching sibling `broll` items. Driving the loop past an
  approve/reject in these tests required manually flipping `run.state` back
  to `'RUNNING'` after each — `HumanActionService.approve`/`.reject` only
  enqueue a `run/resumed` wakeup row; the actual state transition normally
  happens via the Inngest-driven wakeup consumer, which isn't running in
  this no-Inngest test style (the same reason `createRun` itself has to set
  `RUNNING` by hand after creation).
- Chunk 6: all stage-mode approve/reject e2e and unit coverage
  (`phase4-actions.e2e.test.ts`, `human-action.service.test.ts`'s existing
  test body) passes with zero behavioral changes — verified by running the
  full suite, not just the new file.
- Chunk 7: found and fixed two real, previously-unexercised gaps while
  building the §25.1 `broll` acceptance scenario for real (a `video.generate`
  stage iterating `memory:shots`, binding `startFrame` from
  `{from:'prevItem', path:'lastFrame'}`) — precisely what the chunk exists to
  catch: (1) `binding-types.ts`'s `resolveBoundType` narrowed
  `{from:'prevItem', path:'lastFrame'|'firstFrame'}` as an ordinary
  JSON-schema path into the iterating stage's own output type, so the
  validator rejected the spec's own canonical shape ("a media.video artifact
  has no fields to path into") — the derived-frame shortcut always yields a
  `media.image` regardless of the stage's real output kind, and the validator
  never special-cased it. Fixed by short-circuiting to `{kind:'media.image'}`
  for that exact ref/path combination before generic path-narrowing runs.
  (2) `MemoryService.buildWriteCallback`'s "did the write path resolve"
  guard ran before the media-vs-data branch, so ANY media-kind stage with a
  `writes` entry threw `"...did not resolve against the finalized artifact's
data"` — `source.data` is legitimately always `undefined` for a media
  artifact (its payload lives in `artifactId`/blob), which the guard didn't
  know. Fixed by skipping the "value resolved" check entirely for media
  writes (they never had a `value` to check in the first place). Both are
  narrowly scoped, non-schema fixes; full unit/e2e suites re-verified green
  after each.
- Chunk 7: `apps/api/test/e2e/phase7-broll.e2e.test.ts` builds
  `script -> shots -> broll -> music -> timeline` (dropping `vo`/`timing`/
  `draft`/`final` from §25.1's full 9-stage example — they add no new
  binding/invalidation coverage beyond what this file and Chunks 1-6's own
  suites already exercise) with `broll` using the REAL `video.generate`
  capability (not a stand-in `llm.generate`, unlike Chunks 4-6's own
  precedent) so `{from:'prevItem', path:'lastFrame'}` really exercises
  `DerivedFrameService`, with a `TestableDerivedFrameService` subclass (same
  pattern as `derived-frame.e2e.test.ts`) swapped in via a new
  `buildTestApp(testDb, {derivedFrame})` option so the suite stays CI-safe
  (no real ffmpeg). Two tests: the §25.4 failure trace (item 3 of 6 forces a
  check failure via `{..., forceFail:true}` baked into the `shots` array and
  a script check reading `{from:'item'}`, exhausts `itemRetryLimit:1`, items
  0-2 stay `passed` with untouched artifacts/ledger entries, items 4-5 never
  start, the run is driven to `FAILED`/`cursorStageKey:'broll'` by hand since
  this suite has no Inngest orchestrator, then a `run.inputs`-driven kill
  switch "fixes" the check and a resume restarts exactly at item 3 without
  regenerating or recharging items 0-2); and the §25.4 invalidation trace
  (retrying `broll` item 2 via `InvalidationService.preview`/`.apply`
  directly — the same real, tested mechanism `RunActionService
.confirmStageRetry` itself calls, though its own HTTP-facing
  `previewInvalidation`/`confirmStageRetry` still don't accept an `itemIndex`
  end to end, a pre-existing gap this chunk didn't need to close — invalidates
  items 2-5 of `broll` and `timeline` (reads `memory:broll`), and explicitly
  does NOT invalidate `music` (reads only `memory:script`), matching §25.4
  verbatim).
- Chunk 7: the "fix and resume" step for the failure trace does not edit the
  `shots` artifact's `forceFail:true` data directly (that would invalidate
  `shots` itself and cascade well beyond what §25.4's own trace touches) —
  it adds a second check ref, `{from:'input', inputKey:'disableForceFailCheck'}`,
  and flips `run.inputs` via a raw DB update, mirroring exactly how
  `phase7-iteration.e2e.test.ts`'s own Chunk 4 precedent "fixes and resumes"
  its forced failure. The spec's own prose ("patches the stage config via
  `PATCH /runs/:id/overrides`") describes a real HTTP flow this test doesn't
  drive — the point of this suite is engine correctness (partial resume,
  invalidation), not exercising that unrelated endpoint.
- Chunk 7: `apps/api/test/acceptance/phase7-broll-frames.ts` (the real-ffmpeg
  local acceptance script) could NOT be run via plain `tsx`, unlike
  `phase6-render.ts`'s convention — it drives `StageRunnerService`/
  `DerivedFrameService` through real NestJS constructor-type DI, which needs
  `emitDecoratorMetadata`; `tsx` transforms via esbuild, which silently drops
  that emission (confirmed empirically: an `EngineConfig` instance built
  under `tsx` had an `undefined` `ConfigService`, with no error — Nest just
  treated the constructor as taking zero parameters). This is exactly why
  `vitest.config.ts` already swaps in `unplugin-swc` instead of esbuild's
  default transform for the very same reason. Resolved by adding a
  dedicated `apps/api/tsconfig.acceptance.json` (real `tsc`, real
  decorator-metadata emission) and a new `test/acceptance/run-phase7-broll.sh`
  that compiles to a throwaway `dist-acceptance/` (cleaned up via `trap` on
  every exit, since it isn't covered by the repo's eslint `ignores` and
  editing `eslint.config.mjs` is gated), symlinks the compiled tree's
  relative `../../drizzle` lookup back to the real migrations folder, and
  runs the result with plain `node`, preloading env via a small
  `test/acceptance/preload-env.cjs` `--require` hook (needed because
  `AppModule`'s `ConfigModule.forRoot({validate})` runs the instant that
  module is imported, before any of the script's own top-level code could
  otherwise set `DATABASE_URL`/`NODE_ENV`). `package.json`'s
  `acceptance:phase7-broll` now points at that shell script instead of a
  bare `tsx` invocation. Manually re-run: `pnpm --filter @reefcraft/api
acceptance:phase7-broll` passed, real `ffmpeg` extraction confirmed (2
  invocations logged, second resolution of the same derived frame proven
  cached via a call-count spy on a `CountingDerivedFrameService` subclass
  that still calls the real `runFfmpeg` via `super`).
- Chunk 7: the acceptance script's width/height assertion on the derived
  frame's probe is conditional, not unconditional as the plan's sketch
  implied — real `ffprobe` on a lone single-frame PNG (no `-frames:v 1`
  duration concept) returns no `format.duration` field at all, so
  `MediaProbeService.probe()` throws and `DerivedFrameService`'s own,
  pre-existing try/catch degrades gracefully to a probe-less blob (its doc
  comment already anticipated this, just described it as rarer than it
  turned out to be — it's the standard behavior for any still-image
  extraction, not a "some builds" edge case). The script still hard-asserts
  a non-empty `sourceKey`/real blob row (proving the extraction and
  persistence happened for real) and only checks width/height when a probe
  actually got stored, logging the graceful-degradation case otherwise
  rather than treating it as a failure.
- Chunk 7: item-mode approval (`approval.mode:'item'`) is deliberately not
  layered onto the acceptance scenario's `broll` stage — `item-approval.e2e
.test.ts` (Chunk 6) already covers it end to end in isolation, and combining
  it here would add complexity without new coverage per the task's own
  explicit escape hatch for this decision.
- Chunk 7: `docs/build-progress.md`'s Phase 7 row flips to `done` with a
  `(pending PR)` placeholder in the PR column — the real PR number isn't
  known yet, and the "PR opened against main" checkbox above stays
  unchecked; both are the next, separate step.
