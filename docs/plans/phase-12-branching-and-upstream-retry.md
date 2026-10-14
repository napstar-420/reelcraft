# Phase 12 — Output-based branching and QC upstream retry

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F2).
Baseline: after Phase 11 (DAG execution). Both halves depend on Phase 11
(conditions are evaluated when a stage becomes ready; reroutes apply after a
wave drains).
Scope: (A) generalise `enabledWhen` into conditions over inputs, stage outputs,
QC scores and memory, plus joins; (B) let a QC/check failure send the run back
to re-run an **earlier** stage with the critique. Loop-until is deliberately
**not** a new construct (see end).

Recommendation: one PR, with the **upstream-retry (B) commits first**, because B
is the stated need. Split into two PRs if review size demands.

## B. QC upstream retry

The requirement: "if a QC rejects the output of a stage, I want it to be able to
retry its previous stages as well and not only its own stage, for generating
better quality or if something went wrong in the previous stages."

### Current state

- QC and check failures loop on the same stage until `qc.maxAttempts` / `checkMaxAttempts` is spent (`stage-attempt-loop.ts:162-189`), then fail or hand off (`qc.onExhausted`, `shared/src/qc.ts:25-27`).
- Only a **human rejection** can route back (`approval.onReject.retryStageKey`): it builds an item-aware invalidation seed (`human-action.service.ts:301-366`), sets `stage_attempt.critiqueTargetStageKey` (`db/schema/execution.ts:149`, index at `:162`; written at `human-action.service.ts:418`), and the target's next prompt gets the note via `loadCritiqueLog` (`stage-runner.service.ts:535-551`).
- Round counting resets on invalidation (`countRoundAttempts`, `:373-418`).
- The QC judge is told to "not infer anything about how it was produced" (`qc/qc-prompt.ts:8`, spec §10.2 independence).

### Requirement ambiguities and chosen defaults

1. _When_ does it route back? **After the stage's own attempts are spent** (cheapest first, then blame upstream).
2. _Which_ stage? **One stage the author names.** "Judge picks" (auto) comes later (below).
3. What re-runs? The target **and everything that read it**, via the existing invalidation closure. Unrelated branches untouched.
4. What does the target receive? **The critique text**, labelled with the downstream stage's name; not the rejected output.
5. Limit? **Per stage, per run, `maxRounds`, default 1**, never reset within a run (not even by the automatic re-run).
6. After the limit? **Fall through to `qc.onExhausted`** (fail or human review).
7. Human confirmation before the automatic re-spend? **No**: automatic within `maxRounds`, an optional money ceiling, and the run cap.
8. Checks as well as QC? **Both**, via `on`.
9. Items? Re-run the **failing item's aligned upstream item** when the target iterates aligned, otherwise the whole target (same rules as human rejection).

### Design

- Shared `StageDef`:
  ```ts
  retryUpstream: z.object({
    stageKey: z.string(), // must be an ancestor
    on: z.array(z.enum(['qc', 'checks'])).default(['qc']),
    maxRounds: z.number().int().min(1).optional(), // default 1, documented
    maxRerunUsd: z.number().positive().optional(), // skip routing if the preview estimate is higher
  }).optional();
  ```
  Stage-level so checks and QC share it; mirrors `approval.onReject.retryStageKey`.
- **Critique injection:** generalise the `routed` query in `loadCritiqueLog` (`stage-runner.service.ts:535-551`) to outcomes `('rejected','qc_failed','check_failed')` with `critiqueTargetStageKey = this stage`. QC rows render as "Quality control on «Images» rejected a result built from your output: <critique>". Index `stage_attempt_critique_target_outcome_idx` covers it.
- **Counting:** rounds used = this execution's attempts with outcome `qc_failed`/`check_failed` and non-null `critiqueTargetStageKey`. These rows survive invalidation, so the bound holds. No migration.
- **Attempt loop** (`stage-attempt-loop.ts:169`): when `failuresUsed >= maxAttempts` and the failure kind is in `on`, run step `decide-reroute-<iteration>` via a new `runner.decideReroute(...)`. In one transaction it counts rounds, previews invalidation with a seed from a helper **extracted from `HumanActionService.reject`** (`buildRetrySeed(graph, stageKey, target, itemIndex)`, shared by both callers), compares the estimate with `maxRerunUsd`, and if routing stamps `critiqueTargetStageKey` on the failing attempt. Returns `{ outcome: 'reroute', targetStageKey, itemIndex? }`, a new member of `StageAttemptOutcome` (`:46-52`); it is not an attempt outcome, so no enum migration. If it does not route, the existing `onExhausted` path runs.
- **Bubbling:** `stage.execute`'s batch treats `reroute` as stopping (mildest rank) so no further item batches start. The orchestrator applies reroutes **after the wave drains** (no sibling is still running on soon-to-be-stale inputs): step `apply-reroute-<stageKey>-<n>` re-previews and calls `InvalidationService.apply` with `forcedStageKeys:[stageKey]` under the run row lock. If the wave also has a stopping outcome, apply the reroute and then park; otherwise continue the loop (the target is now stale, so ready). Re-invocations use `occurrenceId` (`invoke-stage-<k>-2`, from Phase 11).
- **Termination:** each stage triggers at most `maxRounds` reroutes per run; attempts per round are bounded by `maxAttempts`; nested reroutes are each bounded. Total finite with no global cap (add one only if requested, Q8).
- **Approval gates:** a re-run target with `approval` pauses again (intended; critique visible in attempt history).
- **Parallel branches:** the closure re-runs only readers of the target.
- **Validator:** `stageKey` exists and is an ancestor (an earlier but unrelated stage could not change this stage's inputs); `on` matches declared `qc`/`checks`; target without `instructions.template` is a warning (copy the `checkApprovalOnReject` wording, `:659-668`). Note: video QC becomes possible with Phase 13 framesheets; until then video stages route on `checks` only (or use approval).
- **"Auto" (judge proposes the faulty stage): deferred.** It conflicts with judge independence (§10.2). Ship later as `retryUpstream.candidates: string[]` with a `blame` field validated like `failedClips` (`qc-runner.service.ts:220-238`), fed by Phase 13's `QcVerdict.issues[].source` (`input:<slot>`).
- **UI:** inspector Checks & QC: "If this stage keeps failing: Fail / Ask me to review / Re-run an earlier stage [ancestor picker] up to [1] times, only if it costs under [$]". Canvas: dashed back-edge labelled "re-run on QC fail". Run page: `stage_event` `stage.rerouted` — "Sent back to «Script» (round 1 of 1): …".

### Steps (B)

1. `refactor(api)`: extract `buildRetrySeed` from `HumanActionService.reject`.
2. `feat(shared)`: `retryUpstream` schema (+ guide coverage).
3. `feat(api)`: critique log reads routed QC and check critiques.
4. `feat(api)`: `decideReroute` and the `reroute` outcome in the attempt loop and item batches.
5. `feat(api)`: orchestrator applies reroutes after the wave; occurrence step ids.
6. `feat(api)`: `retryUpstream` validator rules.
7. `feat(web)`: inspector, back-edge, run events.

## A. Conditions (generalised `enabledWhen`)

### Current state

- `EnabledWhen = {input, equals}` (`stage-def.ts:8-12`), evaluated once by `isStageEnabled` (`enabled-when.ts:7-16`) in the load step (`run-orchestrate.fn.ts:164-170`).
- Consistency rule needs an identical condition (`sameEnabledWhen`, `blueprint-validator.service.ts:969-972`).
- A ref to a skipped producer **throws** ("no active artifact", `binding-resolver.service.ts:597-602`) although spec §16.6 says it resolves to absent.
- `coalesce` already returns the first defined branch (`:376-382`): it is already the join primitive.

### Design

- Shared `condition.ts`:
  ```ts
  type Operand = Ref | { from: 'verdict'; stageKey: string; dimension?: string }; // QC score of the stage's active attempt
  type Condition =
    | { all: Condition[] }
    | { any: Condition[] }
    | { not: Condition }
    | {
        value: Operand;
        op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
        to?: unknown;
      };
  enabledWhen: z.union([LegacyEnabledWhen, Condition]).optional();
  ```
  Legacy `{input, equals}` normalised at read time into `{value:{from:'input',inputKey}, op:'eq', to}`, keeping the string-trim coercion (`enabled-when.ts:13-15`). No saved-graph migration.
- `apps/api/src/orchestration/condition.ts` replaces `enabled-when.ts` (delete it): pure `evaluate(condition, operands)`, `conditionStageRefs(condition)`.
- **Timing:** operand stages become dependencies (added to `refDeps`). A condition reading only inputs is still evaluated in the load step (legacy step ids unchanged). Any other condition is evaluated in step `eval-condition-<key>` when the stage becomes ready. False -> `skipStage`, recording a `stage_event` `stage.skipped` with the evaluated operands (no column needed). A stage that runs records operands in `resolved_inputs` under `condition.*` so the closure sees them.
- **Skipped producers:** the resolver returns `undefined` when the producer's `stage_execution.state === 'skipped'` for `prev` and `stage` refs (instead of throwing). Memory reads keep throwing on nothing-written; joins use `coalesce`.
- **Join:** no new node type. A join is any stage whose slot is `{from:'coalesce', refs:[{from:'stage',stageKey:'pathA'},{from:'stage',stageKey:'pathB'}]}`.
- **Validator:** operand typing via `resolveBoundType`; `verdict` only legal in conditions and only on a stage with `qc`; `op` must suit the operand type. The consistency rule generalises: a required binding to a conditional producer needs an identical condition (canonical JSON) or a **total** `coalesce` (one branch unconditional, or branches include `c` and `{not:c}`); else error.
- **Invalidation:** skipped stages have no attempt, so `InvalidationService.preview` attaches `conditionReads` (stage keys from the StageDef, same static approach as `stageBindsPrevItem`, `invalidation.service.ts:52-67`) to every node; `computeInvalidationClosure` marks a node invalid if any condition read is invalid, so re-evaluation can flip the branch.
- **Cost:** estimates become upper bounds over all branches; amend spec §16.6.
- **Web:** Flow control "Enabled when" becomes a rule builder (All/Any; rows of operand via BindingPicker filtered to input/stage/memory/"QC score of …", op, value). Skipped cards show "Skipped: <condition text>". Conditional edges drawn dashed.

### Steps (A)

8. `feat(shared)`: `Condition` + legacy normalisation; `feat(api)`: `condition.ts`, delete `enabled-when.ts` (port its tests).
9. `feat(api)`: ready-time condition evaluation, skipped producer resolves to `undefined`, `stage.skipped` events.
10. `feat(api)`: condition validator + condition reads in invalidation.
11. `feat(web)`: condition builder and skipped display.
12. `docs`: spec, guide, `apps/docs`.

## Loop-until: not a construct

- Single-stage "until" = checks/QC + `maxAttempts` (exists).
- Stage-group loop = `retryUpstream` targeting the group head, a check as the condition, `maxRounds` as the iteration cap.
- Accumulating loops ("write chapters until the story ends") = `iterate` over a planned list, or a sub-workflow per chapter (Phase 16).
  Ship as recipes (`guide-recipes.ts`) and docs. Revisit only if a real blueprint cannot be expressed (Q12).

## Tests

- **Unit:** `evaluate` truth tables + legacy coercion parity with the old `enabled-when.test.ts` cases; coalesce totality; `decideReroute` (rounds, `maxRerunUsd`, item seed); `loadCritiqueLog` with routed QC rows.
- **InngestTestEngine:** images stage exhausts QC, routes to script; script re-invoked as `invoke-stage-script-2`; images re-invoked; run completes. A second exhaustion with `maxRounds: 1` -> FAILED.
- **e2e:** `qc-upstream-retry.e2e.test.ts` (closure staled only the target's readers; critique appears in the target's next `renderedPrompt`; ledger re-spends; aligned item reroute, `item-approval.e2e` style). `conditional-branches.e2e.test.ts` (branch on a stage output; join coalesces; retrying the condition's source re-evaluates the skipped branch).

## Risks

| Risk                                  | Mitigation                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Runaway money                         | `maxRounds` (default 1), optional `maxRerunUsd`, run cap (`budget_blocked` -> `PAUSED_BUDGET`) |
| A reroute stales a running sibling    | Apply only after the wave drains                                                               |
| A condition flip leaves orphan memory | Tombstone path in `InvalidationService.apply` unchanged                                        |

## Backward compatibility

Legacy `enabledWhen` normalised at read time. `retryUpstream` absent on old stages. No migration.

## Spec amendments

§3.5/Appendix A (`retryUpstream`, `Condition`); §6.1 (skipped producer = absent); §10.5 (routed QC/check critiques; `retryUpstream` beside `retryStageKey`; remove "the only backward reference by name"); §15.2 (condition reads, reroute seeds); §16.2/16.3/16.6 (conditions at ready time, total coalesce, cost upper bounds); §25 (upstream-retry trace); §26.

## Open decisions (default in bold)

6. Route upstream only after own attempts are spent, after N, or on first failure? **After own attempts spent.**
7. One named stage, or QC judge chooses ("auto")? **Named; auto later.**
8. `maxRounds` per stage per run (default 1, never reset)? Also a run-wide cap or reset on manual retry? **Per stage per run; no run-wide cap.**
9. Automatic re-spend without confirmation? **Yes within `maxRounds`/`maxRerunUsd`/run cap.**
10. Upstream receives only the critique, or the rejected output too? **Critique only.**
11. Is "QC score of earlier stage + output fields + inputs + memory" enough, or do you need "branch on failure" (a stage that fails without failing the run)? **Enough for now.**
12. Confirm no separate loop-until construct. **Confirmed unless you object.**
