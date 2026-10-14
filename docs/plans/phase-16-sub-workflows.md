# Phase 16 — Sub-workflows and nested iteration

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F3).
Baseline: after Phases 11 and 12 (benefits from parallel children and
conditional children, but does not strictly require them). Also interacts with
Phase 14: child-run cascade ordering and the child-persist rule.
Scope: embed one blueprint as a stage of another (`blueprint.run`, a child
**run**), and implement nested iteration (scenes -> shots) on top of it. Loop-until
is a recipe, not a construct (Phase 12).

## Decision: child runs, not inlined stages

A `blueprint.run` stage creates a child `run` row. The child reuses the
orchestrator, run page, approvals, ledger, invalidation and stage-key namespace
unchanged. Inlining would need key prefixing and cross-graph validation.

## Design

### Schema (migration number assigned at implementation time; latest is `0036`, Phase 14 takes `0037`)

- `run.parent_run_id` (FK `run`, indexed).
- `run.parent_stage_attempt_id` (FK `stage_attempt`, **unique**): idempotent child creation per parent attempt; encodes the item through `stage_attempt.stageItemId`.
  Both nullable; existing runs untouched.

### Capability

`blueprint.run` is registered like the human interactions (`runner.interactionFor`, `stage-execute.fn.ts:60-70`): an engine-executed capability. Config `{ blueprintVersionId, outputStageKey? }` (output defaults to the last stage). Slots and output are **derived by the validator** from the pinned child version, supplied via `BlueprintValidationInput.childVersionsById`, loaded by `BlueprintService` the way it loads `assetsById`. This keeps `CapabilityModule` free of db and blueprint imports (CLAUDE.md). Child `InputDef` keys become slots and are type-checked as slots; the output is the child output stage's `OutputDef`.

### Validator

The child version must exist, be `runnable`, be saved (not a draft), and belong to the **same channel** (Q16). **Cycles are impossible:** pins are to immutable existing versions, so A v3 cannot pin a version that pins A v3; no recursion guard or depth cap needed.

### Execution (in `stage.execute`, `blueprint.run` branch)

1. `ensure-child`: one transaction reserves in the **parent** ledger with ceiling = `budget.stageCapUsd`, else the child version's `runCapUsd`; creates the child run (`budgetCapUsd` = that ceiling, inputs mapped from resolved slots) and starts it through the wakeup outbox.
2. Wait loop: `step.waitForEvent('run/settled', {match childRunId, timeout:'1h'})` followed by `step.run('child-state')`. The DB read makes the wait race-safe (an event sent before the wait began is caught on the next check), at about 24 steps per day of waiting.
3. On COMPLETED: copy the child's output artifact into the parent stage by **sharing the blob id** (seeded-run precedent, `invalidation.service.ts:315-327`, `run-seed.ts` `copyReusedStages`), then settle `actual = child.spentUsd`.
4. On FAILED/CANCELLED: the stage fails with "Sub-run failed: …" and a provisional actual of the spend so far.
   `RunStateService.transition`: when `parentRunId` is set and the new state is terminal or paused, emit `run/settled`.

### Child approvals and inputs

The child parks itself; the parent stays RUNNING and its stage shows "Waiting for sub-run (needs you)". Notifications come from the child (`notifyRun`). The parent run page gets a Sub-runs panel with deep links (Q13).

### Propagation

Cancelling the parent cancels its children recursively (parent lock first, then child). Manual pause/resume propagate to children. Cancelling a child directly fails the parent stage. Invalidating actions on a child whose parent stage has finalised return 409 "retry from the parent run". Retrying the parent stage creates a new child; the old one stays as history.

### Delete cascade (CLAUDE.md rule)

`deleteRunsCascade` (`run/run-cascade.ts:30-75`) first recurses into `select id from run where parent_run_id in (runIds)` because children reference the parent's `stage_attempt`. **Coordinate with Phase 14:** the `channel_memory.run_id` null-out/delete statements run per batch of run ids, so the recursion must collect all descendant ids first, then apply memory handling and deletes once. Add a child-run (and grandchild) case to `channel-delete-cascade.e2e.test.ts`. `BlueprintService.delete` (`blueprint.service.ts:170-195`) refuses (409) while any version of another blueprint pins one of its versions. The runs list filters `parent_run_id is null`.

### Child runs and channel memory

Child runs do **not** honour their blueprint's `persist` (avoids N pending proposals per outer item); the supported path is the parent stage's `persist` on the child's output (Phase 14 Q13).

### Packages (`apps/api/src/package`)

Export bundles pinned child pipelines recursively into the manifest (`subPipelines` keyed by a slot ref, like assets in `package-export.service.ts:234-250`), covered by the existing package signature. Import installs children first and remaps `config.blueprintVersionId`. Dedupe by `blueprint.packageId` is Q14.

## Nested iteration = sub-workflows

Scenes -> shots is an outer stage that iterates `over` scenes with capability `blueprint.run`, where each item runs a child blueprint that itself iterates shots. Not a recursive `stage_item` tree, because:

- **No schema changes:** no `stage_item.parent_item_id`, no `shot#2.1` memory keys, no tree-shaped invalidation closure (`invalidation-closure.ts` is already the most delicate code in the engine).
- **Free behaviour:** per-item retry, partial resume (child = item), approvals, budget and invalidation already work per run and per item.
- **Concurrency:** outer `iterate.concurrency` limits concurrent children; the inner limit lives in the child. They multiply; documented, not capped.
- **Item scoping:** `itemAlias` and `{from:'item'}` map onto child inputs, one level deep.
- **`iterate.groupKey`** (`stage-def.ts:37`) has no remaining purpose; **delete it** (Zod strips unknown keys so saved graphs still parse; Q15).
- **Cost:** a run row per outer item (tens to hundreds); a parent cannot read a child's intermediate stages, only its output.

## Steps (one PR `feat(api): run another blueprint as a stage`, branch `feat/sub-workflows`)

1. Migration, schema and the recursive cascade, with cascade e2e.
2. `blueprint.run` capability registration, child-version lookup, validator rules, blueprint-delete guard.
3. Child-run branch in `stage.execute` (ensure, wait, finalise) and parent-ledger settlement.
4. `run/settled` emission; cancel/pause propagation; child mutation guard; runs-list filter.
5. Package export/import bundling.
6. Web: palette "Run another blueprint" (blueprint and version picker; slots auto-listed from child inputs), Sub-runs panel, child breadcrumb.
7. Remove `iterate.groupKey`; loop recipes; guide and docs; ADR-0014.

## Tests

- **Unit:** validator (wrong channel, non-runnable, slot/input mismatch, output-stage typing); settlement maths.
- **E2E `sub-workflow.e2e.test.ts`:** child completes and the parent artifact shares its blob; child failure fails the parent stage; resuming the child after fixing it, then the parent, finalises; cancel propagates; iterate-over-children with `concurrency: 2`; cascade covers grandchildren; package round-trip with a child.

## Risks

| Risk                                    | Mitigation                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Ledger double-count                     | Parent reserves the child cap once; the child's ledger is separate; settle once on terminal |
| Child edited after the parent finalised | 409 guard                                                                                   |
| Long `waitForEvent`                     | Hourly timeout plus DB check                                                                |
| Inngest step budget with many children  | Each child wait is ~24 steps/day; iterate batches bound fan-out; revisit at movie scale     |

## Open decisions (default in bold)

12. Confirm no separate loop-until construct. **Confirmed.**
13. While a sub-run waits for you, parent shows RUNNING + "sub-run needs you", or mirrors the paused state? **Show RUNNING + hint.**
14. Package import: reuse an installed child with the same `packageId`, or always install fresh? **Reuse by `packageId` + version.**
15. Delete the unused `iterate.groupKey` now? **Yes.**
16. Child blueprints same channel only, or any channel you own? **Same channel.**
