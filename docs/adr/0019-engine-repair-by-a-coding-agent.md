# ADR-0019: The assistant can have a coding agent repair the engine, from source only

**Date**: 2026-11-09
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Reelcraft's engine is young, and videos made with it keep hitting bugs in Reelcraft's own code: a
stage type that throws, a schema that rejects what a stage documents, a file handed between stages in
the wrong shape. Each bug used to be fixed by hand, one at a time. The blueprint assistant (ADR-0009)
already watches runs and can tell a blueprint problem from an engine one, but it could only report the
engine problems. The maintainer produces videos with `pnpm dev` from a checkout, and wanted the
assistant to fix those bugs, test the fix, retry the stage, and leave a pull request to review.

## Decision

- **A `repair_engine` tool, an `action`.** The assistant calls it with a diagnosis once it has read
  the failure (`get_stage`, `get_attempt`). Manual mode asks first. It is refused unless
  **Settings › Assistant › Engine repair** is on and Reelcraft runs from a git checkout. When
  `NODE_ENV` is `production` or there is no checkout (the image), the switch is disabled and says why.
  Only one repair runs at a time, and a stage gets at most two.
- **A repair is a chat item.** The `repair` item's `state` (`working | applied | pr_only | failed`)
  and payload `phase` (`preparing → fixing → verifying → publishing → applying`) carry it, so
  `EngineRepairService` picks a repair up again after the restarts it causes. There is no new table:
  the item goes with its chat, which is already in the delete paths. The payload's run id is
  informational.
- **The coding agent is the chat's own (Codex or Claude) in a git worktree.** It runs as a detached
  CLI job through the existing runner (ADR-0016) in `code` modality. The new `cwd` manifest field makes
  the worktree (`WORKSPACE_ROOT/repairs/<id>/repo`) its working folder. Claude gets file tools and
  `Bash` for `pnpm` and read-only `git` only. Codex works in its profile's sandbox, rooted at the
  worktree. The agent never commits, pushes or switches branches. It answers with a strict JSON report
  (`engineBug`, `summary`, `commitMessage`, `testFiles`). `engineBug: false` ends the repair with what
  it found, and the assistant fixes the blueprint instead.
- **The pre-commit hook is the check.** Reelcraft commits the change itself, without `--no-verify`, so
  lint, the typechecks and the unit suites must pass. The agent is told to run the same checks (the
  whole unit suites, not only its own tests) before it answers. When the hook still fails, its report
  (the failing tests and type errors first, colour codes removed) goes back to the agent once, with its
  change still in the worktree; a second failure fails the repair with that report.
- **Pull request first, live apply last.** The branch is pushed and a pull request opened with the
  user's own `git` and `gh`. A failure there is recorded, not fatal. Then the diff is `git apply`'d to
  the running checkout, uncommitted. `packages/shared` goes first and is rebuilt before the rest
  lands. If the patch does not apply cleanly (the checkout has its own changes there), the repair ends
  as `pr_only`. Applying is last because `nest --watch` reloads the API.
- **The chat hears the outcome once.** The service marks the item `reportedAt` and wakes the chat
  through `AssistantWatchService.wakeSession`. That uses the same queue as run wakes, so it waits for
  boot recovery. An applied fix is reported on the next boot, or after 60 s when the fix doesn't
  restart the API. The wake asks the assistant to `retry_stage`.

## Alternatives considered

- **Diagnose and file an issue only.** Safe, but it leaves the maintainer doing every fix by hand,
  which is what this replaces.
- **Show the patch in the chat and apply it only after approval.** The pull request is already the
  review, and approving twice slows the loop that matters while producing a video.
- **Let the agent edit the live checkout directly.** Every edit would reload the API mid-repair, and a
  bad half-fix would break the running app. The worktree keeps the live app untouched until the checks
  pass.
- **A new `engine_repair` table.** It would need a migration and delete-cascade upkeep for state that
  belongs to one chat.
- **Offering repair on the image.** The image has a compiled bundle and no source. A fix there could
  only arrive through a release, which a pull request already leads to.

## Consequences

- In dev, the assistant can change Reelcraft's code. The agent can run any `pnpm` script in the
  worktree. That is a deliberate step past ADR-0009's and ADR-0016's lockdown, limited to source
  checkouts and an opt-in switch.
- Fixes reach the running checkout before review. The pull request decides whether they reach `main`.
- Each apply reloads the API: chat turns running then are marked interrupted, and Inngest runs carry on.
- A fix that fails the hook gets one retry with the hook's report, which can double a repair's time.
  Feeding the output back to the same agent thread is the next step if this proves common.
- The 60 s wait for a reload is a guess for `nest --watch`.
