# Phase 4 Inputs & HITL — TDD evidence

## RED

- Durable run control: five focused suites initially failed because
  `RunService` bypassed the run lock/outbox, `RUNNING` did not clear
  `endedAt`, the dispatcher function was absent, and orchestration did not
  claim revision-bound events.
- Invalidation: the Postgres acceptance test initially imported a missing
  `InvalidationService`.
- Recovery actions: focused tests initially failed to import the missing
  `RunActionService` and `ArtifactEditService`.
- Human waits/actions: focused tests initially failed to import the missing
  `HumanWaitService`, `HumanActionService`, reminder service, and cancellation
  service.
- The first full E2E regression pass exposed 23 failures after the new
  reservation guard, proving older fixtures were attempting paid work while
  runs were still `CREATED` and that old resume assertions bypassed the new
  durable claim boundary.

## GREEN

- API unit suite: 36 files / 224 tests passed before final documentation
  changes; the final workspace test command is recorded in verification.
- Shared DTO suite: 5 files / 15 tests passed.
- Full Postgres/Inngest E2E suite: 16 files / 100 tests passed, including the
  new invalidation and Phase 4 approval/human-input/cancellation suites.
- `pnpm typecheck` and `pnpm lint` passed.

## Refactor and regression notes

- Existing Phase 1–3 fixtures now explicitly mark directly-executed runs
  `RUNNING`; production code retains the cancellation-safe locked guard.
- Budget resume tests now assert that the run remains parked until its
  revision-bound wakeup is claimed.
- Artifact finalization accepts a caller-owned transaction, keeping
  stale/activate/repoint/memory/state changes atomic.
- Run Memory current-value reads select the highest version before filtering
  tombstones, preventing older values from resurfacing.

## Remaining hardening

- The destructive process-restart durability exercise and the complete
  independent-client race matrix remain Phase 4 chunk 7 work. The phase stays
  marked in progress until those checks are run.
