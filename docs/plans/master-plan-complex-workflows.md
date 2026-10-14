# Master plan — Reelcraft for complex video-generation workflows

Status: **proposed, awaiting confirmation. No code has been written.**
Baseline: `main` at `4a1e381` (release 0.10.0).
Source: an architect-led review of the engine, QC, render, provider, character and
memory code (three parallel research tracks), consolidated here. Every `path:line`
reference in the sub-plans was read from the code at this baseline.

## 1. Goal

Today Reelcraft makes short, linear reels well. This plan matures it into a
platform for **complex video-generation workflows**: parallel branches,
output-driven branching, QC that can send the run back to the stage that caused a
problem, reusable sub-workflows, casts of several (even run-generated)
characters, QC on video, cinematic timelines, richer video capabilities, and
**memory that persists across runs**.

The long-term aim is 2–3 hour movies. That is **not** the target of this plan;
the plan is shaped so nothing here blocks it, and section 8 lists what is
deliberately left for later.

## 2. Feature map

| #   | Feature (from our discussion)                                              | Phase         | Sub-plan                                                                             |
| --- | -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| F1  | Parallel / DAG execution (**build next**)                                  | 11            | [phase-11-dag-execution.md](phase-11-dag-execution.md)                               |
| F2  | Output-based branching + QC retry of **previous** stages                   | 12            | [phase-12-branching-and-upstream-retry.md](phase-12-branching-and-upstream-retry.md) |
| F5  | QC on video via framesheets                                                | 13            | [phase-13-framesheet-qc.md](phase-13-framesheet-qc.md)                               |
| F7  | Persistent memory                                                          | 14            | [phase-14-channel-memory.md](phase-14-channel-memory.md)                             |
| F4  | Multi-character shots + per-run generated characters                       | 15            | [phase-15-characters-cast.md](phase-15-characters-cast.md)                           |
| F3  | Loops, sub-workflows, nested iteration                                     | 16            | [phase-16-sub-workflows.md](phase-16-sub-workflows.md)                               |
| F6  | Richer timeline / render                                                   | 17            | [phase-17-timeline-render.md](phase-17-timeline-render.md)                           |
| F8  | Thin video capabilities/providers (lip-sync, extend, upscale, v2v, voices) | 18 (+ Wave 0) | [phase-18-video-capabilities.md](phase-18-video-capabilities.md)                     |

Phases 11–18 continue the numbering in [`docs/build-progress.md`](../build-progress.md).
Add each row there **when the phase starts** (that file tracks the state of `main`,
not intentions).

## 3. Headline decisions across the plan

| Topic                    | Decision                                                                                                                                                                                                                                                                                                                      | Phase |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Scheduling               | Dependencies are **derived** from refs; no `dependsOn` means "wait for the previous stage", so every saved blueprint stays a chain. The stage array stays a valid topological order. Waves + drain-then-park.                                                                                                                 | 11    |
| QC upstream retry        | `retryUpstream: { stageKey, on, maxRounds, maxRerunUsd }`: after the stage's own attempts are spent, re-run one author-named ancestor with the critique injected; everything that read it re-runs via the existing invalidation closure. Reuses `critiqueTargetStageKey` (no migration). "Judge picks the stage" is deferred. | 12    |
| Branching                | `enabledWhen` generalises to `Condition` (inputs, stage outputs, QC score, memory; and/or/not). Joins are plain `coalesce` over `{from:'stage'}`. Skipped producers resolve to absent.                                                                                                                                        | 12    |
| Loop-until               | **No new construct**: upstream retry + checks, `iterate`, or a sub-workflow.                                                                                                                                                                                                                                                  | 12/16 |
| Video QC                 | Judge a labelled **framesheet** (1–3 images); free signal checks for black/frozen/silence/loudness; approval stays the gate for motion/lip-sync. Spec §10.1 amended.                                                                                                                                                          | 13    |
| Persistent memory        | New `channel_memory` table (text/data only), reads pinned per run (`memory_as_of_seq`), writes **declared** (`persist`) and **committed at run completion** with human review by default, optimistic versioning. Postgres FTS, **no pgvector**.                                                                               | 14    |
| Multi-character          | N roles; one new `cast` ref feeding the existing `references` slot; **explicit** reference budget (no auto-degradation); identity-labelled prompts.                                                                                                                                                                           | 15    |
| Run-generated characters | A **run role** read from Run Memory keys; promotable to a channel Character.                                                                                                                                                                                                                                                  | 15    |
| Sub-workflows            | A `blueprint.run` stage creates a **child run**; **nested iteration = sub-workflow per outer item** (no recursive item tree).                                                                                                                                                                                                 | 16    |
| Timeline                 | Additive schema, `version: 2` only when new fields are used (safe updater rollback), CSS/SVG parity between preview and render, ffmpeg "conform" for speed ramps/LUTs.                                                                                                                                                        | 17    |
| Providers                | Model registry table with `tasks`, `pricing`, limits; adapters never spread raw params; fake models per task.                                                                                                                                                                                                                 | 18    |

## 4. Sequencing

```
Wave 0  independent correctness fixes (small PRs, any order, can start now)
          0a fal adapter: map frames/refs, record real spend, validate limits  (Phase 18 / F8.1)
          0b render: honour overflow loop/freeze/speed, audio fades, duck level (Phase 17 / F6.0)
          0c collect derived-frame blobs on invalidation                        (Phase 13 / step 1)

Wave 1  Phase 11  DAG execution                    <- you asked for this next
           │
Wave 2     ├── Phase 12  branching + upstream retry   (needs 11)
           ├── Phase 13  framesheet QC                (independent; feeds 12 later)
           └── Phase 14  persistent channel memory    (independent)
           │            (12, 13, 14 can go in any order after 11)
Wave 3  Phase 15  characters / cast                 (independent; optional link to 14)
Wave 4  Phase 16  sub-workflows + nested iteration  (needs 11; benefits from 12; coordinate cascade with 14)
Wave 5  Phase 17  timeline / render (F6.1–F6.7)     (independent)
        Phase 18  video capabilities (F8.2–F8.6)    (F8.2 needs 11; F8.4 needs 15)
```

Recommended order after Phase 11: **12 → 13 → 14 → 15 → 16 → 17 → 18**. Reasoning:
12 is your stated need; 13 completes QC for video, which makes 12's upstream
retry usable for video stages; 14 is the missing-persistent-memory item. If you
want memory sooner, 14 can move directly after 11 with no rework (it does not
depend on 12/13).

**Git workflow (project rule):** the repo squash-merges and stacked PRs conflict.
So: **one PR per feature, one commit per step**, each phase branched from `main`
**after** its predecessor has merged. Branches: `feat/dag-execution`,
`feat/branching-upstream-retry`, `feat/framesheet-qc`, `feat/channel-memory`,
`feat/characters-cast`, `feat/sub-workflows`, `feat/timeline-*`, `feat/video-capabilities`.
Stage files explicitly (no `git add -A`). Versions/changelog are release-please's;
don't edit by hand.

## 5. PR inventory

| PR                               | Branch                            | Commits (approx.) | Migration                                                | Image change                            |
| -------------------------------- | --------------------------------- | ----------------- | -------------------------------------------------------- | --------------------------------------- |
| 0a fal done right                | `fix/fal-adapter-wiring`          | ~7                | no                                                       | no                                      |
| 0b render honours overflow/fades | `fix/render-overflow-audio-fades` | ~4                | no                                                       | no                                      |
| 0c derived blob GC               | `fix/derived-frame-gc`            | 1                 | no                                                       | no                                      |
| 11 DAG                           | `feat/dag-execution`              | 8                 | **no**                                                   | no                                      |
| 12 branching + upstream retry    | `feat/branching-upstream-retry`   | 12                | **no**                                                   | no                                      |
| 13 framesheet QC                 | `feat/framesheet-qc`              | 7–8               | no                                                       | no (ffmpeg 6.1 + fonts already present) |
| 14 channel memory                | `feat/channel-memory`             | 11–12             | **yes (0037)**                                           | no                                      |
| 15 characters / cast             | `feat/characters-cast`            | 13                | **no**                                                   | no                                      |
| 16 sub-workflows                 | `feat/sub-workflows`              | 7                 | **yes** (`run.parent_run_id`, `parent_stage_attempt_id`) | no                                      |
| 17 timeline (F6.1–6.7)           | `feat/timeline-*` (6–7 PRs)       | per PR            | no                                                       | only if fonts/LUT files ship            |
| 18 video caps (F8.2–8.6)         | `feat/video-*` (5 PRs)            | per PR            | yes (character voice)                                    | no                                      |

Any change to `docker/app/` or `@remotion/renderer` needs a `docker/app/RUNTIME_VERSION`
bump (CI-enforced). The plan avoids image changes; the pgvector option in Phase 14
and shipping fonts/LUTs in Phase 17 are the only ways to trigger one.

## 6. Cross-cutting reconciliations (where phases touch the same code)

1. **Ref variants.** Phase 11 adds `{from:'stage'}`, Phase 14 `{from:'channelMemory'}`,
   Phase 15 `{from:'cast'}`. Each must ship with: `ref.ts` type + union, resolver case,
   validator rules, assistant guide text (`guide.test.ts` fails CI if a Ref kind is
   missing), `assistant/tools/json-schemas.ts`, web `BindingPicker`/`ref-paths.ts`.
   Hotspots for rebase conflicts: `ValidationContext`, `RefProvenance`, `guide.ts`.
   Because phases merge sequentially (section 4) there is no stacked-PR problem.
2. **`producerOf` (Phase 11)** becomes the single place that answers "which stage does
   this ref read?" Phases 12 (`stage` operands), 14 (none) and 15 (`cast`/run-role
   writers must be dependency-ordered) reuse it.
3. **`deleteRunsCascade` (CLAUDE.md rule).** Phase 14 adds `channel_memory` statements
   (null `run_id` on committed rows, delete pending/rejected/conflict rows); Phase 16
   adds child-run recursion. When both exist, collect **all descendant run ids first**,
   then apply memory handling and deletes once. Each phase extends
   `channel-delete-cascade.e2e.test.ts`; Phase 15 adds the promoted-Character blob
   assertion; Phase 13 adds framesheet blobs. No other new tables.
4. **Verdict plumbing.** Phase 13 emits `QcVerdict.issues[].source` (`input:<slot>`);
   Phase 12's deferred "auto" upstream retry will consume it. Until Phase 13 lands,
   `retryUpstream.on:['qc']` is unavailable for video stages (QC on video is forbidden);
   `on:['checks']` works.
5. **Persist vs sub-workflows.** Child runs (Phase 16) do **not** honour their blueprint's
   `persist`; the parent stage's `persist` on the child's output is the supported path
   (otherwise N pending proposals per outer item).
6. **Characters × memory.** Character _state over time_ lives in channel memory
   (`character.<id>.state`); identity images live in the Character. Promotion (Phase 15)
   can optionally seed a `character.<id>.profile` entry once Phase 14 exists.
7. **Character voices (Phase 18, F8.4)** depend on Phase 15's role resolution.
8. **Inngest step budget.** Phase 11 (~3 steps per stage worst case) and Phase 16
   (~24 steps/day per waiting child) grow step counts. Re-check before the movie horizon
   (section 8).
9. **Spec upkeep.** The spec is already stale in places (§10.1/§10.3 video QC, §11.1,
   §13.4, §14). Each phase's docs commit amends only its own sections and adds a §28
   revision entry; ADRs 0013–0017 are allocated below.
10. **Docs/guide.** User-facing changes update `apps/docs` (exact UI labels, stable slugs —
    `apps/web/src/lib/docs-url.ts` links to them) and the assistant guide in the **same**
    PR. `apps/docs` installs with `pnpm install --ignore-workspace`.

ADR allocation: **0013** dependency-derived scheduling in waves (11); **0014** sub-workflows
as child runs (16); **0015** multi-character reference budget: explicit, no auto-degradation (15);
**0016** persistent channel memory (14); **0017** framesheet QC (13). Numbers follow the
order phases land; renumber if the order changes.

## 7. Definition of done (every phase)

- Shared Zod is the source of truth; API contract changes update shared DTOs; web imports
  **types only** from `@reelcraft/shared` (web-only helpers in `apps/web/src/lib/`).
- Provider keys via `KEY_PROVIDER`; money via `toUsd`/`fromUsd`; artifact replacement stales
  the old artifact before inserting the new one in one transaction; run state changes flow
  through the durable wakeup/outbox + Inngest pipeline (the UI never drives execution);
  `DbModule` imported explicitly; `CapabilityModule` imports no `db`/`run`/`blueprint` modules.
- New tables with FKs into the channel/blueprint/run graph are added to the delete cascade,
  `storage_orphan` queueing where files exist, and the cascade e2e tests.
- Unit tests beside source; E2E under `apps/api/test/e2e/` on the **fake provider** (free,
  deterministic). Per project memory, only ChatGPT works for live testing; OpenRouter/Codex/fal
  are covered by unit tests. Use the isolated dev stack for anything touching a database
  (separate compose project + worktree `.env`; never the live DB/containers/ports), and
  rebuild shared + restart `pnpm dev` after switching branches.
- Validation gate: `pnpm typecheck`, `pnpm lint && pnpm format:check`, `pnpm test`,
  `pnpm test:e2e`, `pnpm --filter @reelcraft/web typecheck` (and render-worker typecheck for
  Phase 17).
- Docs: spec amendments, ADR, `apps/docs`, assistant guide, in the same PR.
- No silent engine caps: limits are user-set, validated, and documented.

## 8. The horizon: 2–3 hour movies

What this plan buys: parallel branches (11), QC that repairs upstream causes (12), video
QC (13), long-range continuity (14), casts (15), hierarchical structure via sub-workflows
(16), cinematic assembly (17), the clip-level tools a narrative needs (18).

Deliberately **not** in this plan; each has a trigger to revisit:

| Not built                                                               | Trigger                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Critical-path (per-stage promise chain) scheduling instead of waves     | Branches of very different length make wall-clock visibly worse           |
| Chunked/parallel Remotion rendering, shared resource dir / signed URLs  | Renders > ~10 min or timelines > ~30 min (designed in Phase 17)           |
| Inngest continuation wakeups for very large graphs                      | A graph approaches ~900 steps per function                                |
| Semantic memory recall (pgvector + embeddings)                          | Measured FTS recall failures and a usable embedding provider              |
| Built-in `memory.summarize` capability                                  | Digest-writing blueprints converge on a pattern                           |
| Judge-chosen upstream stage ("auto" retry)                              | After Phase 13's `issues[].source` data proves reliable                   |
| Roles as typed inputs (§18.6)                                           | Non-person identities or launch-time casts become common                  |
| Compositing fallback for crowd shots                                    | A model/workflow needs more identities than `maxRefs` even with `primary` |
| Local face-embedding identity check                                     | Vision-judge identity QC proves insufficient (runtime-image change)       |
| Model fallbacks (`ModelPin.fallbacks`), per-provider concurrency limits | Provider contention or outages hurt real runs                             |
| Approval-fatigue tooling (batch review, auto-accept thresholds)         | Human gates dominate wall-clock on long films                             |

## 9. North-star acceptance blueprint

To keep the phases honest, finish each wave by extending one integration blueprint (fake
provider, e2e) toward this "serialized animated episode":

1. Read `story.digest` + last episodes from **channel memory** (14); design a **run-generated
   cast** with turnaround sheets, reviewed (15).
2. Plan scenes; iterate scenes as **child runs** (16), each planning shots (nested iteration).
3. Per shot: **parallel** music / voiceover / b-roll branches (11); generate video; **framesheet
   QC** (13); on repeated failure, **send back to the shot planner** with the critique (12);
   dialogue shots via **lip-sync** (18).
4. Assemble a timeline with PiP, grades, keyframes, a speed ramp and loudness target (17).
5. At completion, **persist** the new digest and character state as pending memory (14).

| Wave | Slice of the blueprint it proves                   |
| ---- | -------------------------------------------------- |
| 1    | step 3 parallel branches                           |
| 2    | steps 3 (branch/retry/framesheet) and 1/5 (memory) |
| 3    | step 1 cast                                        |
| 4    | step 2 child runs                                  |
| 5    | steps 3 (lip-sync) and 4                           |

## 10. Risk register

| Risk                                        | Impact                               | Mitigation                                                                                              |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Phase 11 replay of in-flight runs           | Duplicate/stuck stages               | Legacy step ids/order unchanged; missing `deps` = chain; existing InngestTestEngine suite is the gate   |
| Runaway spend from automatic upstream retry | Money                                | `maxRounds` (default 1), `maxRerunUsd`, run cap, ledger `PAUSED_BUDGET`                                 |
| Memory poisoning compounds over episodes    | Quality                              | Human review default, draft runs pending, history + revert, provenance                                  |
| Provider contention from parallel branches  | Rate limits/ban risk on ChatGPT/Flow | Per-adapter serialisation unchanged; documented; opt-in limits later                                    |
| Many hand-edits to `graph[i-1]` sites       | Missed site = wrong producer         | Single `producerOf`, grep-driven commit, parity test per validator rule                                 |
| fal endpoints/prices drift                  | Wrong cost/payload                   | One model table, payload snapshots, dated price comments                                                |
| Scope: 8 large phases                       | Slippage                             | Wave 0 ships value immediately; every phase is independently shippable after its dependencies           |
| Rollback by the in-app updater              | Silent data loss                     | Timeline `version: 2` only when new fields used; additive jsonb everywhere; migrations only in 14/16/18 |

## 11. Decisions

### 11.1 Needed before Phase 11 starts (defaults proposed; say "go" to accept)

1. While one branch waits for your approval/input, do other independent branches keep
   running? **Default: no — no new stages start until the run parks** (spec §12.4 forbids
   approving a RUNNING run).
2. Waves now, critical-path later? **Default: waves.**
3. New canvas stages default to "Runs after: previous stage". **Default: yes** (today's behaviour).
4. Per-provider "max jobs at once" in Settings? **Default: none.**
5. Two unordered stages writing the same memory key: **Default: error.**

### 11.2 Your call on Phase 12 (QC upstream retry), the item you described

I read your requirement as: when QC rejects stage N, the run may **re-run an earlier stage
that caused the problem (and everything between)**, with the critique, instead of only
retrying N. The sub-plan's defaults — please confirm or change:

- Route upstream **only after the stage's own attempts are spent** (not on first failure).
- The **author names one ancestor stage**; the QC judge does not pick (it would break judge
  independence, spec §10.2; "auto" comes later).
- Upstream gets **the critique only**, not the rejected output.
- **`maxRounds` per stage per run, default 1**, never reset; optional "only if it costs under $X"; plus the run budget cap.
- **No human confirmation** before the automatic re-spend. (Alternative: pause with a cost preview like a human rejection.)

### 11.3 Defaults that apply unless you object (decided per phase)

Listed with their defaults at the end of each sub-plan: framesheet defaults and spec
amendment (13); memory `review:'human'`, blueprint-scoped "series", draft runs pending-only,
no memory in packages, optional rejection-note lessons (14); no auto reference degradation,
turnaround-sheet recipe, `launch` roles, promote-as-new (15); same-channel child blueprints,
delete `iterate.groupKey`, no loop construct (16); `version: 2` rule, parameter looks only,
model-written timelines limited to a small subset (17); fal media upload with a Settings kill
switch, no model fallbacks yet, character voice on the Character (18).

## 12. What I need from you

Confirm the plan (or tell me what to change): the **order** after Phase 11, the **Phase 11
defaults** in 11.1, and the **Phase 12 defaults** in 11.2. On confirmation I will start with
Wave 0 and Phase 11 on their own branches. Nothing is implemented until then.
