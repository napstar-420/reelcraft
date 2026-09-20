# PR Review: #17 — feat(iterate): Phase 7 — Iteration

**Reviewed**: 2026-09-20
**Author**: napstar-420 (Zohaib Khan)
**Branch**: `codex/phase7-iteration` → `main`
**Decision**: REQUEST CHANGES (original) → **RESOLVED**, see below

## Resolution

The HIGH finding is fixed. `BindingResolverService.resolveAll()` now folds
`stage.iterate.over`'s own resolved `RefProvenance` into the returned
`provenance` map under a reserved `'iterate.over'` key (fix designed by the
`ecc:architect` agent after re-verifying every claim in the original finding
against current code — `resolveIterateCount` was confirmed unable to host
this data, since it runs once per stage before any `stage_attempt` row
exists; `resolveAll` is the only call site whose output is actually
persisted into `resolved_inputs`, and it already runs once per item per
attempt). `computeInvalidationClosure` needed no changes — it already
iterates every provenance entry regardless of key name.

A new regression test,
`apps/api/test/e2e/phase7-broll.e2e.test.ts`'s `"retrying the array producer
(shots) cascades into every broll item and its downstream memory-group
reader..."`, drives the exact scenario the original review found untested —
retrying `shots` (the array producer) via the same seed shape
`RunActionService.confirmStageRetry` uses in production
(`{stageKeys:['shots']}`) — and was confirmed to fail without the fix
(`affectedStageKeys` stopped at `['shots']`) and pass with it
(`['shots','broll','timeline']`, covering all 6 `broll` items) before being
committed.

The two MEDIUM and two LOW findings were not addressed in this pass — they
are lower-severity, and one (MEDIUM #3) is an already-documented, deliberate
scope boundary. They remain open for a future pass if desired.

## Summary

A well-structured, thoroughly-tested implementation of the phase (248 unit + 140 e2e tests, a real-ffmpeg acceptance script, all green in CI). The per-item orchestration design, the derived-frame row-lock/cache pattern, and the item-mode approval transaction boundaries are all sound. However, one HIGH-severity gap undermines the phase's core promise: an iterating stage's dependency on its own `iterate.over` source is never recorded in `resolved_inputs`, so invalidating/retrying the stage that produces the iterated array does not cascade to the stage that iterates over it — the exact class of staleness bug item-level invalidation exists to prevent. This should be fixed (or explicitly scoped out with a tracked follow-up and a validator/runtime guard) before merge.

## Findings

### CRITICAL

None found.

### HIGH

**1. `apps/api/src/artifact/binding-resolver.service.ts:317` (`resolveAll`) and `apps/api/src/orchestration/stage-runner.service.ts` (`resolveIterateCount`) — an iterating stage's `iterate.over` dependency is never recorded in `resolved_inputs`, so invalidating its source never cascades to it.**

`resolveAll()` resolves `stage.iterate.over` via `const { value } = await this.resolve(stage.iterate.over, ctx)` — the `provenance` half of the result (which for `{from:'memory'}`/`{from:'prev'}` carries the real `memoryVersion`/`artifactId`) is discarded and never added to the `provenance` map that becomes `stage_attempt.resolved_inputs`. `resolveIterateCount` (the stage-level count resolution in `stage-runner.service.ts`) does the same. Separately, `resolve()`'s `case 'item':` returns `provenance: { ref }` with no `artifactId`/`memoryVersion` either, so even a slot/context bound to `{from:'item'}` carries no traceable link back to the array's source.

_Failure scenario:_ blueprint `script → shots (writes memory:shots) → broll (iterate over memory:shots) → timeline`. Retrying/regenerating `shots` produces a new artifact and a new `memory:shots` version, applied via `InvalidationService.apply()`. Because nothing in any of `broll`'s per-item `resolved_inputs` references `shots`'s artifact id or memory version, `computeInvalidationClosure`'s forward pass never marks any `broll` item invalid — `broll` and everything downstream stay `'passed'`, silently built from a superseded array. The PR's own acceptance test (`phase7-broll.e2e.test.ts`) never exercises "retry the array producer, does the iterating consumer go invalid" — it only tests retrying individual `broll` items, not `shots` itself — so CI does not currently catch this.

_Suggested direction:_ have `resolveAll`/`resolveIterateCount` fold `iterate.over`'s own provenance into the returned/recorded provenance map (e.g. under a reserved key like `"iterate.over"`), and give `{from:'item'}`'s resolved provenance the underlying array-source's `memoryVersion`/`artifactId` so a per-item read of the array is traceable too.

### MEDIUM

**2. `apps/api/src/orchestration/stage-runner.service.ts` (`ensureStageItems`) — no self-consistency guard if a stage's own resolved `iterate.over` length changes across re-entries of the same `stage_execution`.**

`ensureStageItems` unconditionally overwrites `stageExecution.itemCount` with the freshly-resolved count, and `INSERT ... ON CONFLICT DO NOTHING` never resets pre-existing `stage_item` rows. If the resolved array length shrinks or grows between two invocations without going through the invalidation path that would otherwise reset the stage (Finding 1 is one way this could happen silently), trailing `stage_item` rows from an old count are neither marked stale nor revisited, and a shrink-then-grow could cause an index to be treated as already `'passed'`/`'failed'` against a different underlying element. There's a runtime assertion for cross-stage `alignWith` count consistency but nothing analogous against this stage's own prior `itemCount`.

**3. `apps/api/src/run/run-action.service.ts:36-39` / `apps/api/src/run/run.controller.ts` — `previewInvalidation` accepts `itemIndex` over HTTP but unconditionally rejects it with `ConflictException`.**

`InvalidationSeed.items` is fully implemented and exercised by the approve/reject flow, but there is no HTTP-reachable way to preview/confirm a single-item retry outside of approve/reject. This is a documented, deliberately-scoped-out gap per `.claude/plans/phase-7-progress.md` (Chunk 7's own notes), not an oversight — flagging for visibility since it's a real product gap, not asking it be closed in this PR.

### LOW

**4. `apps/api/src/artifact/binding-resolver.service.ts` (`fetchMemoryRows`) — a tombstoned exact-key match produces a misleading error instead of naming the real cause.**

When `ref.key` matches a row exactly but it's a tombstone, the code falls through to `listGroupCurrent`, which almost always finds nothing, and the caller throws a generic "no memory entry ... (an indexed group read is tried under ...)" message that never mentions the tombstoned exact match. Cosmetic — doesn't affect correctness — but will confuse debugging of a legitimately-invalidated read.

**5. `apps/api/src/artifact/derived-frame.service.ts` (`manifestFor`) — `hasAudio` is hardcoded `false` for a derived frame.**

Correct in practice (a single-frame PNG has no audio) but asserted unconditionally rather than derived from probe data — harmless today since only `firstFrame`/`lastFrame` PNGs use this path, but a latent trap if this manifest type is ever reused elsewhere.

### What checked out fine (no issues found)

- `ArtifactService.finalize()`'s stale-then-activate ordering is correctly preserved for the item path; both previously-known Chunk-3-era gaps (idempotency key collision, missing `itemIndex` on `recordAttemptArtifact`) are fixed in the current code.
- `DerivedFrameService.extract()`'s row-lock + jsonb-merge race guard is correct — Postgres's `SELECT ... FOR UPDATE` re-check-under-lock semantics mean a second concurrent caller reliably observes the first caller's committed `derived` update rather than double-extracting or corrupting the merge.
- `HumanActionService`'s item-mode approve/reject have no TOCTOU window — `resolveOpenItem` and the mutation happen inside the same locked transaction, and reject's pre-lock preview is safely revalidated against `run.revision` inside the final transaction.
- `computeInvalidationClosure`'s propagation algorithm itself (same-stage `bindsPrevItem` cascade, `alignWith:'item'` pointwise cross-stage invalidation) is correct when traced by hand against non-trivial scenarios; `apply()` correctly tombstones per-item memory keys, not just the bare key, for a whole-stage invalidation.
- No SQL-injection risk in any phase-7 `sql\`...\`` usage (all interpolated values are Drizzle-parameterized); no path-traversal risk in the ffmpeg/workspace code (all path segments are type-constrained literals or internally-generated ulids).

## Validation Results

| Check                         | Result                                  |
| ----------------------------- | --------------------------------------- |
| Shared package build          | Pass                                    |
| Type check                    | Pass                                    |
| Lint                          | Pass (1 pre-existing unrelated warning) |
| Format check                  | Pass                                    |
| Unit tests                    | Pass (248/248)                          |
| E2E tests                     | Pass (140/140)                          |
| Real-ffmpeg acceptance script | Pass                                    |
| CI (GitHub Actions)           | Pass (both check runs green)            |

## Files Reviewed

Core source (read in full): `artifact.service.ts`, `binding-resolver.service.ts`, `derived-frame.service.ts`, `memory.service.ts`, `artifact.module.ts`, `binding-types.ts`, `blueprint-validator.service.ts`, `db/schema/execution.ts`, `orchestration/functions/{index,run-orchestrate.fn,stage-attempt-loop,stage-execute-item.fn,stage-execute.fn}.ts`, `stage-runner.service.ts`, `config-resolver.service.ts`, `stage-def-layer.ts`, `human-action.service.ts`, `invalidation-closure.ts`, `invalidation.service.ts`, `run-action.service.ts`, `run.controller.ts`, `object-key.ts`, `packages/shared/src/stage-def.ts` — all Modified.

Tests and config (reviewed at a lighter touch, matching the large-PR guidance to prioritize source first): all `*.test.ts`/`*.e2e.test.ts` changes, `drizzle/0010_stage_item_failure.sql` + snapshot (Added), `package.json`, `tsconfig.acceptance.json` (Added), `README.md`, `docs/build-progress.md`, `docs/plans/phase-7-iteration.md`, `.claude/plans/phase-7-progress.md`, `.gitignore`.
