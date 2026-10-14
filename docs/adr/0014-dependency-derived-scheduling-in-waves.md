# ADR 0014: Stages are scheduled from their dependencies, in waves

- Status: accepted
- Date: 2026-10-14

## Context

`run.orchestrate` walked the stages one at a time, in array order. A video whose music, voice-over and
b-roll don't need each other still made them one after another. Blueprints already saved by users, and
runs in flight, must not change behaviour, and the engine has no migration to spend on this.

## Decision

- **Dependencies are derived, with one opt-in field.** A stage waits for the stage behind every `prev`
  and `{from:'stage'}` ref it reads, for every earlier writer of a memory key it reads, and for
  `dependsOn`. With `dependsOn` unset it waits for the previous stage, so every saved blueprint is still a
  chain. `dependsOn: []` means "start when my inputs are ready".
- **The stage array stays a topological order.** Every dependency points to an earlier index, enforced by
  the validator. The invalidation closure, final-video choice and seed prefix rule rely on it.
- **Waves, not a promise per stage.** Each pass starts every ready stage together with
  `Promise.allSettled`, then plans again. A fast branch's successor waits for the slowest stage of its
  wave. That is simple to replay deterministically; a per-stage promise chain is the upgrade if branches
  of very different length matter.
- **Drain, then park.** Once any stage in a wave stops (failure, budget, quota, approval, input), nothing
  new starts, the siblings finish, and the run parks on the worst outcome.
- **Chains keep their Inngest step ids.** A golden test pins them. A wave adds only one new id,
  `mark-paused-waiting`, for a run that wakes with every remaining stage waiting on a person.
- **Human actions are gated on the open wait, not on the cursor.** There can be several waits at once.
  A wait is _live_ only while its stage or item is still waiting, so waits orphaned by an invalidation are
  ignored and cleaned up. The run wakes once no live wait is left.
- **No migration.** The cursor is still written, as the first ready stage, but only as a hint.

## Alternatives

- **A new `parallel` stage type or group:** hides the real shape, and can't express a join that waits for
  two of three branches.
- **Per-provider semaphores:** an Inngest concurrency limit does not bound a function parked in
  `step.sleep` (see the spec's function topology), and the operator's provider account is the right
  place for a cap.
- **Critical-path scheduling:** better wall clock, harder to replay.

## Consequences

- Two stages that write the same memory key must be ordered; the validator rejects them otherwise.
- Changing only `dependsOn` moves no data, so it does not stale finished work and does not cascade.
- The run page and canvas stop assuming one current stage and read each stage's open wait instead.
- A provider that serialises requests per account makes parallel stages take turns, so the gain depends on
  the provider.
- A run has roughly three Inngest steps per stage; very large graphs approach the step limit.
