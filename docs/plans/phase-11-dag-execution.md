# Phase 11 — Parallel / DAG execution

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F1).
Baseline: `main` at `4a1e381` (release 0.10.0)
Scope: dependency-derived stage scheduling inside one run. Independent branches
run at the same time (for example music, voiceover and b-roll). No branching on
outputs (Phase 12), no sub-workflows (Phase 16).

## Outcome

A stage starts when every stage it depends on has settled (`passed` or
`skipped`). Existing blueprints behave exactly as today (a strict chain), with
the same Inngest step ids, so in-flight runs replay safely. No DB migration.

## Findings the design rests on

| Fact                                                                                                    | Evidence                                                                                                                                                                                                                                                                                     | Consequence                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Array order is execution order and nothing else decides it                                              | `run-orchestrate.fn.ts:29-37` (`orderStageExecutions`), loop at `:178-270`                                                                                                                                                                                                                   | The scheduler is one function; replacing it is local.                                                                                                                                  |
| The orchestrator is state-driven: every invocation re-walks all executions and skips `passed`/`skipped` | `run-orchestrate.fn.ts:179-182`                                                                                                                                                                                                                                                              | A ready-set scheduler derives its set from `stage_execution.state` the same way.                                                                                                       |
| Parallel `step.invoke` fan-out under one Inngest function already ships                                 | `stage-execute.fn.ts:93-163` (batches, `Promise.allSettled`, `worstOutcome` at `:36-40`)                                                                                                                                                                                                     | Reuse this pattern at stage level; nothing new on the Inngest side.                                                                                                                    |
| Concurrent reservations inside a run are already safe                                                   | `ledger.service.ts:64-65` takes the run row `FOR UPDATE` (`lockRunRow`, `:619-635`); `iterate.concurrency` already exercises it                                                                                                                                                              | Ledger needs no change. Only spec §11.1 text ("nothing in a run executes in parallel", line 1023) is stale.                                                                            |
| Several open approvals per run already exist                                                            | `human-wait.service.ts:54-66` (`countOpenApprovals`); wake predicates `othersWaiting` (`human-action.service.ts:64-67,430-433`)                                                                                                                                                              | Generalise "open approvals" to "open waits".                                                                                                                                           |
| Invalidation closure runs one pass in graph order and assumes dependencies point backward               | `invalidation-closure.ts:157-163`                                                                                                                                                                                                                                                            | **Keep the stage array a valid topological order.** Then the closure, `pickFinalVideo` (`final-video.ts:27-31`), seed prefix rule (`run-seed.ts:82-97`) and canvas order stay correct. |
| Many sites hard-code "previous stage = `graph[i-1]`"                                                    | `stage-runner.service.ts:268-269`, `binding-types.ts:60-68`, `blueprint-validator.service.ts:705,856,888,983`, `binding-resolver.service.ts:575-605`                                                                                                                                         | Add one `producerOf(ref, stageIndex)` helper and route all of them through it.                                                                                                         |
| Many sites assume a single cursor                                                                       | `human-action.service.ts:84,145,404,457,501,617`, `timeline-editor.service.ts:109,216`, `run.service.ts:669-679,888`; web `stage-card.logic.ts:188,215`, `approval-review.logic.ts:50`, `run-deep-link.logic.ts:13,19`, `RunPage.tsx:367,374`, `run-tab.tsx:244`, `canvas-run-sheets.tsx:39` | Gate human actions on the open `human_wait` (`requireOpenWait` exists, `human-action.service.ts:107`) instead of `cursorStageKey`.                                                     |
| Spec is already stale on iteration                                                                      | §13.4 "no per-item function" (line 1213), §14 "never in parallel" (line 1242), yet `stage.execute.item` and `iterate.concurrency` ship                                                                                                                                                       | Amend in the docs commit.                                                                                                                                                              |
| `nextVersion` is read-then-insert with no lock                                                          | `memory.service.ts:241-249`                                                                                                                                                                                                                                                                  | Two unordered writers of one key would collide; prevented by a new validator rule, not a lock.                                                                                         |
| A memory reader whose writer is later in the array fails only at run time                               | `binding-types.ts:70-95` takes `writers[0]` without an index check                                                                                                                                                                                                                           | New validator error fixes a latent bug.                                                                                                                                                |

## Locked decisions (proposed; see Open decisions)

1. **Dependencies are derived, with one opt-in field.**
   `refDeps(S)` comes from every Ref in `slots`, `context`, `checks[].refs`,
   `iterate.over` (and, from Phase 12, conditions), flattened through `coalesce`:
   `prev` -> `graph[i-1]`; new `{from:'stage', stageKey}` -> `stageKey`;
   `memory` -> every writer of the base key (strip `#n`) **earlier in the array**
   (today's runtime semantics); `item`/`prevItem`/`input`/`asset`/`role`/`const`
   add nothing. `orderDeps(S) = S.dependsOn ?? (i > 0 ? [graph[i-1]] : [])`.
   No `dependsOn` therefore still waits for its array predecessor: every saved
   blueprint stays a chain. `dependsOn: []` means "start when my inputs are ready".
2. **`prev` keeps its meaning** (array predecessor) and is not deprecated. The
   new `{from:'stage', stageKey, path?, alignWith?}` is the explicit,
   branch-safe way to read a non-adjacent output. The assistant and canvas
   prefer it inside parallel graphs.
3. **The array must be a topological order**: every dependency points to an
   earlier index. This replaces cycle detection (a cycle needs a forward edge,
   which is a validator error) and keeps the §15.2 single-pass closure valid.
4. **Scheduling is in waves.** Each pass invokes every ready stage with
   `Promise.allSettled`, then recomputes the ready set from memoised results.
   `ponytail:` a wave barrier makes a fast branch's successor wait for the
   slowest stage in the same wave; upgrade to one promise chain per stage
   (`chain(k) = all(chain(deps)).then(invoke k)`, still deterministic because
   every decision reads memoised steps) when branches of very different length
   matter (movies).
5. **Drain on any stopping outcome.** If any stage in a wave returns something
   other than `passed`, no new stage starts; in-flight siblings finish; the run
   parks on the worst outcome:
   `failed > budget_blocked > deferred > run_not_running > approval_required > input_required`
   (the iterate-batch semantics, `stage-execute.fn.ts:93-96`).
6. **`run.cursorStageKey` stays one column** with a weaker meaning: the stage
   most recently started, or the one that parked the run. Display/back-compat
   only; nothing gates on it any more.
7. **No per-provider semaphores** (spec §13.4, and the project rule against
   silent internal caps). Authors control fan-out with `dependsOn` and
   `iterate.concurrency`.

## Design

### Shared (`packages/shared`)

- `ref.ts`: add `{ from: 'stage'; stageKey: string; path?: string; alignWith?: 'item' }` to the type and the discriminated union.
- `stage-def.ts`: `dependsOn: z.array(z.string()).optional()` ("Unset waits for the previous stage; `[]` starts as soon as its inputs are ready").
- New pure `stage-deps.ts`: `stageDependencies(graph): Map<string, string[]>` (decision 1) and `ancestorsOf(deps, key)`.
- `dto/run.dto.ts`: `StageExecutionDto.waiting: 'approval' | 'input' | 'timeline_edit' | null`, derived server-side from open `human_wait` rows so the web stops inferring from the cursor.

### DB

No migration.

### Validator (`blueprint-validator.service.ts`, `binding-types.ts`, `validation-context.ts`)

- `ValidationContext` gains `deps`, `ancestors` (computed once in `buildValidationContext`) and `producerOf(ref, stageIndex)`.
- New errors: `dependsOn` names an unknown stage or itself; a dependency (from `dependsOn`, a `stage` ref or a memory read) points to a later stage (`depends on "<X>", which comes after it — move this stage after "<X>"`); `{from:'stage'}` names an unknown key; `{from:'memory'}` whose writers are all later in the array.
- Every `prev`-specific rule switches to `producerOf`, so it applies to `stage` refs too: iterating producer without `alignWith`; `canonicalizeIterateOver` (`:976-999`) gains a `stage` case; `enabledWhen` consistency (`:704-717`); `iterateProducedArity` (`:1005-1018`).
- `approval.onReject.retryStageKey` must be an **ancestor**, not merely earlier (`:648`). In a chain every earlier stage is an ancestor, so legacy graphs gain no errors.
- Two writers of one memory key that are not dependency-ordered are an **error** (last-writer-wins would depend on timing); ordered writers stay a warning. Cannot fire on legacy graphs.

### Resolver (`binding-resolver.service.ts`)

- Rename `fetchPrevArtifact(ctx, ref)` (`:575-605`) to `fetchProducerArtifact(ctx, producerKey, ref)`. `case 'prev'` passes `ctx.prevStageKey`; new `case 'stage'` passes `ref.stageKey`. Mirror in `resolveEnvelope` (`:477`).
- Other prev-aware sites gain the `stage` case: `check-test.service.ts`, `timeline-handle.service.ts`, `human-action.service.ts`, `run-seed.ts`, web `ref-paths.ts`, `BindingPicker.tsx` (about 38 files by grep, mostly tests).

### Orchestration (`run-orchestrate.fn.ts`)

- `load-stage-executions` also returns `deps: string[]` per execution. A memoised result from old code has no `deps`; the scheduler treats a missing `deps` as `[predecessor]` (the old chain). This is the replay-safety rule.
- New pure, exported `planWave(executions, settled, waiting) -> { ready, done, stalled }`, unit-tested like `orderStageExecutions`. _Settled_ = `passed` without `needsItemWork`, or `skipped`. _Waiting_ = stage-level `awaiting_approval`/`awaiting_input`. _Ready_ = neither, and all deps settled. A dependency with `needsItemWork` is not settled.
- Loop sketch:
  ```ts
  for (;;) {
    const { ready, done } = planWave(state);
    if (done) break;
    if (ready.length === 0) return park(openWaitsState ?? 'FAILED: stalled'); // defensive; validator prevents it
    const disabled = ready.filter((k) => !enabled(k));
    for (const k of disabled) await step.run(`skip-disabled-${k}`, ...); // same id as today
    const runnable = ready.filter(enabled);
    if (disabled.length) continue;               // keeps legacy step order identical
    const st = await step.run(`check-runnable-${runnable[0]}`, getState); // one per wave
    if (st !== 'RUNNING') return { state: st };
    await step.run(`set-cursor-${runnable[0]}`, () => setCursor(runId, runnable[0]));
    const settled = await Promise.allSettled(runnable.map((k) =>
      step.invoke(occurrenceId(`invoke-stage-${k}`), { function: stageExecuteFn, data })));
    // rethrow crashes; record passes; worstOutcome() -> park exactly as :215-269
  }
  ```
  For a chain every wave holds one stage, so step ids and order are **byte-identical** to today. The existing `run-orchestrate-inngest.e2e.test.ts` (mocks `invoke-stage-<key>`) must pass unmodified: it is the compatibility proof. `occurrenceId` appends `-2`, `-3` only when a stage is invoked again in the same invocation (needed by Phase 12).
- Move `worstOutcome` from `stage-execute.fn.ts:36-40` to `attempt-outcome.ts`, add `input_required`, share it.
- Parking: `budget_blocked` -> `PAUSED_BUDGET`; `deferred` -> `pauseForQuota`; `failed` -> `FAILED`; `run_not_running` re-reads state. Approval/input use new `HumanWaitService.pausedStateFor(runId)` (`PAUSED_APPROVAL` if any approval wait is open, else `PAUSED_INPUT`). One notification per park.
- `stage.execute` / `stage.execute.item` unchanged. `beginAttempt` idempotency (`stage-runner.service.ts:276-283`) is per `stage_execution`, so parallel stages never conflict; update its comment.
- Budget: no change; update spec §11.1 text.

### Human waits and the cursor

- Replace every `lockedRun.cursorStageKey !== stageKey` check (`human-action.service.ts`, `timeline-editor.service.ts`) with `requireOpenWait(tx, execution.id, kind, item?)`. Allowed run states for approve/reject/retry-QC/submit-input/timeline editor become `['PAUSED_APPROVAL','PAUSED_INPUT']`.
- `countOpenApprovals` becomes `countOpenWaits` (any kind); wake only when none remain; after each resolution, if waits remain, call `pausedStateFor` to correct the badge.
- After a reject's invalidation, also close stage-level waits whose execution is no longer `awaiting_*` (generalises `resolveForItemsNoLongerWaiting`, `human-wait.service.ts:46-51`).
- `RunService.resume` precondition (`run.service.ts:666-680`): "some execution is neither settled nor waiting" replaces "the cursor execution is resumable". `approvalCandidate` (`:888`) checks for an open wait.
- `InvalidationService.apply` still sets the cursor (`invalidation.service.ts:416-419`); harmless.

### Run creation

- `untilStageKey`: mark `skipped` every stage outside `ancestorsOf(target) ∪ {target}` instead of `index > stopIndex`. Identical on a chain.
- `comparableStage` (`run-seed.ts:45-50`) ignores `dependsOn` like it ignores `iterate.concurrency` (scheduling does not change outputs). Keep the prefix-reuse rule (conservative; its own `ponytail` comment names the per-stage fingerprint upgrade).
- Dry run: no change.

### Web

- `apps/web/src/lib/stage-deps.ts`: copy of `stageDependencies` (web imports only types from shared; precedent `memoryLinks` in `canvas-graph.logic.ts:50-64`).
- `stage-graph.logic.ts`, `canvas-layout.logic.ts`: layered layout, `x = level` (longest path), `y = lane`. A chain renders as today's line. Trunk edges from effective deps; memory links stay an overlay.
- Drag-to-reorder stays for stages without `dependsOn`; DAG wiring is done in the inspector.
- `StageInspector.tsx` Flow control: "Runs after": **Previous stage (default)** / **When its inputs are ready** / **Specific stages…**. `BindingPicker`: "Output of stage …".
- Cursor checks in `stage-card.logic.ts:186-189,213-216`, `approval-review.logic.ts:48-50`, `run-deep-link.logic.ts`, `RunPage.tsx:367-374`, `run-tab.tsx:244`, `canvas-run-sheets.tsx:39` move to `execution.waiting`.
- RunPage "Running now: A, B" from every `running` execution. `budgetBlock` stays singular.
- Live events: no change (stage-keyed pings).

## Steps (one commit each; one PR `feat(api): run independent stages in parallel`, branch `feat/dag-execution`)

1. `feat(shared)`: `dependsOn`, `{from:'stage'}`, `stage-deps.ts` + tests; assistant tool JSON schema (`assistant/tools/json-schemas.ts`); guide Ref coverage so `guide.test.ts` stays green.
2. `feat(api)`: resolve `{from:'stage'}`, `producerOf`, remaining prev-aware call sites (grep-driven).
3. `feat(api)`: validator dependency rules, `stage`-ref parity rules, ancestor rules for `onReject` and concurrent writers; `guide-troubleshooting.ts` entries.
4. `feat(api)`: wave scheduler (`planWave`, shared `worstOutcome`, legacy step-id path, missing-`deps` fallback).
5. `fix(api)`: gate human actions on open waits not the cursor; `countOpenWaits`, `pausedStateFor`, resume precondition; `StageExecutionDto.waiting`.
6. `feat(api)`: `untilStageKey` runs ancestors only; seed comparison ignores `dependsOn`.
7. `feat(web)`: layered canvas, "Runs after", stage-output binding, cursor-free run status.
8. `docs`: spec amendments (below), `apps/docs`, assistant guide, ADR-0014.

## Tests

- **Unit:** `stage-deps.test.ts` (chain; `dependsOn: []`; memory writers only earlier; coalesce union; stage ref). `planWave` (diamond; disabled stages; `needsItemWork` blocks dependents; waiting blocks dependents; stall). Validator (forward dependency; unknown/self dependency; unordered same-key writers = error vs ordered = warning; stage-ref parity; `onReject` non-ancestor). `worstOutcome` incl. `input_required`.
- **Inngest (InngestTestEngine, `run-orchestrate-inngest.e2e.test.ts` style):** all existing cases unmodified; diamond A->(B,C)->D invokes B and C in one wave; B fails, C finishes, D never invoked, run FAILED; B needs approval and C passes -> PAUSED_APPROVAL, D not invoked; B budget-blocked and C needs approval -> PAUSED_BUDGET; resume after approve runs only D; a memoised `load-stage-executions` without `deps` replays as a chain.
- **e2e (Postgres), `parallel-stages.e2e.test.ts`:** two branches reserve against one run cap concurrently and `reservedUsd` sums correctly; two open waits (approval + input): answering one keeps the run parked with corrected state, answering the other wakes it; retrying branch B leaves C passed; `untilStageKey` on a branch runs only its ancestors. Extend `run-seed.e2e.test.ts`: a `dependsOn`-only change is still reused.

## Risks

| Risk                                                       | Mitigation                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replaying in-flight runs under new code re-invokes a stage | Legacy step ids/order unchanged; missing `deps` = chain; the existing InngestTestEngine suite is the gate                                                                                       |
| Inngest per-function step budget on large graphs           | About 1 step per wave + 2 per stage, ~3 per stage worst case: a 300-stage graph is ~900 steps. Note in §13.4; a continuation wakeup is the upgrade path. **Re-check before the movie horizon.** |
| Provider contention (one ChatGPT account, Flow credits)    | Per-adapter serialisation unchanged (`chatgpt-provider.adapter.ts:530-539`); document that parallel branches multiply load; see Q4                                                              |
| A missed `graph[i-1]` site                                 | Grep-driven commit 2 + a validator parity test per rule                                                                                                                                         |
| Wave barrier wall-clock cost                               | Accepted (decision 4); upgrade documented                                                                                                                                                       |

## Backward compatibility

Saved graphs without `dependsOn` are chains: identical behaviour, no data migration. In-flight runs: identical step ids plus the `deps` fallback. Cursor consumers: column kept and still written.

## Spec amendments (done in the docs commit)

§3.5/Appendix A (`dependsOn`); §6.1 (`{from:'stage'}`); §6.3 (writers of one key must be dependency-ordered); §11.1 (concurrency is real within a run; row lock carries it); §12.1/§12.4 (several open waits; cursor informational; approve/input allowed in either paused state with an open wait; resume precondition); §13.4 (scheduler topology, drain; remove "Within a run, nothing is parallel" line 1221 and "There is no per-item function" line 1213); §14/§14.2 (document shipped `iterate.concurrency`); §15.2 ("later stage in array order" stays valid because the array is a topological order); §16.1 (ordering invariant = every dependency points earlier); §16.2/16.3 (new rules); §25 (worked diamond example); §26 (decisions: waves, drain, no semaphores). **ADR-0014** "Dependency-derived stage scheduling in waves".

Assistant guide: `guide.ts:25,355` (parallel via `dependsOn`), `:60-61` (prev vs stage), `:357` as needed; `guide-troubleshooting.ts` messages; recipe "parallel audio and video branches with a join". User docs (stable slugs): `blueprints/connecting-stages.md`, `runs/run-page.md`, `runs/when-a-run-needs-you.md`, `reference/run-statuses.md`, `reference/validation-messages.md`, `concepts/how-it-works.md`; new `blueprints/parallel-stages.md`.

## Open decisions (proposed default in bold)

1. While one branch waits on you, should other independent branches keep running? **Default: no new stages start until the run parks** (spec §12.4 forbids approving while RUNNING). Keeping them running means allowing approve/input on a RUNNING run.
2. Wave scheduling now, or true critical-path in this phase? **Waves now.**
3. New canvas stages default to "Runs after: previous stage" or "when inputs are ready"? **Previous stage** (today's behaviour).
4. User-set "max jobs at once" per provider in Settings? **None** (spec §13.4).
5. Two unordered stages writing one memory key: error or warning? **Error.**
