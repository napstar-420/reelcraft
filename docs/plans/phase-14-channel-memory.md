# Phase 14 — Persistent channel memory

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F7).
Baseline: `main` at `4a1e381`. Independent of Phases 11–13 and 15; adds one Ref
variant (`channelMemory`) and one stage field (`persist`), so merge order with
Phase 11 only matters for guide/validator-context conflicts.
Scope: state that outlives a run, scoped to a channel (optionally narrowed to one
blueprint as a "series"): story continuity, character state over time, lore,
style/brand facts, learned preferences, QC lessons, used topics. Reproducible
per run, unpolluted by failed runs, safe under concurrent runs, private in
packages, visible and editable by the user.

## Decisions at a glance

| #   | Decision                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D5  | One append-only table `channel_memory`, **text/data only**. Reads pinned to a run-start sequence (`run.memory_as_of_seq`). Writes **declared** (`StageDef.persist`) and **committed only when a run completes**, automatically or via human-approved proposals, with optimistic versioning. | Reuses the Run Memory mental model (versions, tombstones, `key#n`); reproducibility from a single column; failed/cancelled runs can't pollute; media stays in Characters/Assets so no new blob lifecycle.                |
| D6  | Retrieval = exact key, prefix, tags, plus **Postgres FTS**. **No pgvector, no embeddings.** Rolling digests written by blueprint stages.                                                                                                                                                    | pgvector would be a runtime-image change (`docker/app/Dockerfile:61` stock `postgresql-16`; dev `postgres:16-alpine`, `docker-compose.yml:5`); embeddings need an embedding API and only ChatGPT works for live testing. |

## Current state: Run Memory as it is today

- Table `run_memory` (`apps/api/src/db/schema/memory.ts:16-39`): append-only; current = highest version; tombstones; indexed `key#i` groups; `artifact_id` for media, `data` for JSON.
- Writes: `MemoryService.buildWriteCallback` runs **inside the finalize transaction** of a passing attempt (`artifact/memory.service.ts:137-186`); failed/rejected/cancelled attempts never write (§6.3); an unresolvable path throws (`:150-155`).
- Tombstones: `appendTombstones` (`:67-129`) with a savepoint retry on unique violation (`:97-119`) — the pattern to copy for concurrent version assignment.
- Reads: `{from:'memory', key}` -> latest non-tombstone value or ordered list for a group key (`binding-resolver.service.ts:192-270, 660-700`); provenance records `memoryKey`/`memoryVersion(s)`; invalidation recomputes from them (`invalidation.service.ts:194-221`, `invalidation-closure.ts:180-210`).
- Validator: a memory key must be written by an earlier stage (`validation-context.ts:58-66`); multiple writers is a warning (`blueprint-validator.service.ts:928-935`) although the guide forbids it (`guide.ts:77`).
- Seeding copies memory of reused stages (`run-seed.ts:318-321`); delete via `deleteRunsCascade` (`run-cascade.ts:51`).
- **Nothing persists across runs.** Only channel-level state is `channel.theme/defaults/description` (`db/schema/channel.ts:4-13`).
- Hooks: run completion in `run-orchestrate.fn.ts:272-298` (precedent for a best-effort post-COMPLETED step: `extract-poster`, `:275-294`). COMPLETED runs can be retried/edited (`run-action-policy.ts:38-40`), so **a run can complete more than once**. Human rejection notes live in `stage_attempt.review_note` (`db/schema/execution.ts:148`); QC verdicts in `qc_verdict` (`:147`). Package privacy scan: `package/package-privacy.ts:10-25`.

## Is the Claude-style memory model right here?

Partly. **Adopted:** typed entries (`fact | state | summary | lesson | preference | log`), a short `summary` per entry (an "index" the browser and assistant can list without loading values), recall by key/prefix/tags plus full-text search. **Rejected:** agent-driven recall (a model decides what to read) — spec §2.3 rules out tool-loop agents in the engine, and the validator and reproducibility require reads to be **declared in the StageDef**. The assistant, as an agent, can still browse memory to help author those declarations.

## Data model

New `apps/api/src/db/schema/channel-memory.ts`; migration `0037_channel_memory.sql` (hand-check generated SQL for the identity column, generated `tsvector` column and GIN indexes; Drizzle needs `sql` for the latter).

```sql
channel_memory (
  id            text PRIMARY KEY,
  channel_id    text NOT NULL REFERENCES channel(id),
  blueprint_id  text REFERENCES blueprint(id),     -- NULL = channel-wide; set = this blueprint only
  key           text NOT NULL,                     -- 'story.digest', 'story.episodes#7', 'lessons.hands'
  version       integer,                           -- NULL while status <> 'committed'
  seq           bigint GENERATED ALWAYS AS IDENTITY, -- global commit order for as-of reads
  status        text NOT NULL,                     -- pending | committed | rejected | conflict
  type          text NOT NULL,                     -- fact|state|summary|lesson|preference|log
  kind          text NOT NULL,                     -- 'text' | 'data' (no media in v1)
  data          jsonb NOT NULL,
  schema        jsonb,                             -- JSON Schema of data (copied from the writer's output schema)
  summary       text,
  tags          text[] NOT NULL DEFAULT '{}',
  confidence    real,                              -- informational only
  tombstone     boolean NOT NULL DEFAULT false,
  author        text NOT NULL,                     -- run | user | assistant | import
  run_id        text REFERENCES run(id),           -- nulled when the run is deleted
  source        jsonb NOT NULL DEFAULT '{}',       -- {runId, stageKey, itemIndex, attemptId, artifactId}, kept after run delete
  base_version  integer,                           -- version the writer saw (optimistic check)
  search        tsvector GENERATED ALWAYS AS (to_tsvector('simple', key || ' ' || coalesce(summary,'') || ' ' || data::text)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE UNIQUE INDEX channel_memory_version_uq ON channel_memory (channel_id, coalesce(blueprint_id,''), key, version) WHERE version IS NOT NULL;
CREATE INDEX channel_memory_current ON channel_memory (channel_id, key, seq DESC) WHERE status = 'committed';
CREATE INDEX channel_memory_search ON channel_memory USING gin (search);
CREATE INDEX channel_memory_tags ON channel_memory USING gin (tags);
CREATE UNIQUE INDEX channel_memory_run_source_uq ON channel_memory
  (run_id, (source->>'stageKey'), coalesce((source->>'itemIndex')::int,-1), key, (source->>'artifactId'))
  WHERE run_id IS NOT NULL;  -- idempotent commit
```

Plus `run.memory_as_of_seq bigint` (nullable) in the same migration.

One table with pending proposals as rows: proposals, history and current value share every field; `status` keeps pending entries invisible to reads. **No media in v1:** an entry that needs an image points at a Character/Asset by handle (`character:<id>`) inside its text/data. This avoids a new `blob` scope (`blob.ts:16, 43-48`), GC rules and storage-orphan paths. Promotion (Phase 15) is the route for identity images.

## Shared schemas (`packages/shared/src/channel-memory.ts`, `ref.ts`, `stage-def.ts`)

```ts
MemoryType = z.enum(['fact','state','summary','lesson','preference','log']);
PersistDef = z.object({
  path: z.string(),                         // '$' or a dot path into the output (text/data outputs only)
  mode: z.enum(['replace','append']),       // append -> key#n (next index at commit)
  type: MemoryType, tags: z.array(z.string()).default([]),
  summaryPath: z.string().optional(),
  scope: z.enum(['channel','blueprint']).default('channel'),
  review: z.enum(['auto','human']).default('human'),
});
StageDef.persist?: Record<memoryKey, PersistDef>

// Ref
| { from: 'channelMemory';
    key?: string;                        // exact key or 'key#n'; bare group key -> ordered list
    prefix?: string; tags?: string[]; search?: string | Ref;   // list read
    limit?: number; order?: 'recent' | 'oldest' | 'relevance';
    scope?: 'channel' | 'blueprint' | 'both';  // default 'both' (blueprint entries shadow channel ones)
    path?: string; fallback?: unknown }
```

DTOs: `ChannelMemoryEntryDto`, `ChannelMemoryHistoryDto`, `UpsertChannelMemoryDto {data, type, tags, summary?, baseVersion}`, `DecideProposalDto {decision:'approve'|'reject', data?}`.

## Reading

- **Pinning:** `RunService.start` sets `run.memory_as_of_seq = (SELECT max(seq) FROM channel_memory WHERE channel_id=…)` in the same update that snapshots `assetBindings` (`run.service.ts:365-368`). Every read filters `status='committed' AND seq <= asOf`, taking the latest version per key that isn't a tombstone. One column makes key, prefix and FTS reads deterministic for the life of the run, including retries days later (same idea as `assetBindings`, §6.2). A concurrent episode run committing mid-way is not seen, deliberately. Optional run-page action **Refresh channel memory** (paused/failed runs) would bump `asOf` through `withLockedRun` and add a new §15.1 invalidation trigger (Q9).
- **Resolver:** new `case 'channelMemory'` delegating to `ChannelMemoryService.read(channelId, blueprintId, asOf, ref)`. Key read -> the value or `fallback`. Group/list read -> ordered array with `limit`/`order`; `relevance` uses `ts_rank` with `websearch_to_tsquery('simple', search)`; a `search` Ref (e.g. `{from:'input', inputKey:'topic'}`) is resolved first. Provenance `{ref, channelMemory: [{entryId, key, version}]}`.
- **Invalidation:** channel memory is **external to the run**, like an asset; its reads never enter the §15.2 closure.
- **Seeding:** `reusableStageKeys` (`run-seed.ts`) gets a new stop reason `memory_changed`: a reused stage whose recorded channel-memory entries are no longer the latest at the new run's `asOf` stops reuse, shown in `stage.rerun_reason` (`run.service.ts:293-304`). Mirrors `assets_changed`.
- **Prompt size, no silent caps:** a list read **requires an explicit `limit`**; no engine maximum. Validator errors when missing, warns above 50. `inputs.resolved` events record characters injected per binding; the binding picker shows a size estimate from the API. Large state stays small by the **rolling-digest pattern**.

## Writing

- **Declared only**, through `StageDef.persist`. Capabilities never write channel memory; runs never write it mid-run.
- **Commit when the run completes.** New durable step `persist-memory` after `mark-completed` in `run-orchestrate.fn.ts:272`, best-effort like `extract-poster` (`:275-294`) so a memory error never fails a finished video. `ChannelMemoryService.commitRun(runId)`:
  1. Skip if `run.dryRun`.
  2. For each stage with `persist`, take its **active** artifact(s) (`stale=false`; per item for iterating stages), resolve the path; an unresolved path is an error (same rule as `memory.service.ts:150-155`).
  3. Idempotency via the unique index. A **re-completed run** (retry after COMPLETED) only adds rows for artifacts that changed; older committed versions from the same run stay as history, shown as "superseded by a later completion of the same run".
  4. `review:'auto'`: commit in a transaction. `replace`: if the current committed version differs from `base_version` **and** came from another source, mark `conflict` instead of overwriting. `append`: assign `key#(max+1)`. Version/index assignment retries on `23505` with a savepoint (copy `memory.service.ts:97-119`).
  5. `review:'human'`: insert `pending` and send a `memory_review` notification (inbox/push, ADR-0011).
  6. Runs of a canvas draft (`blueprint_version.draft`) always go through `pending`.
- **FAILED/CANCELLED runs never commit** (nothing is staged before completion). Run page: **Commit memory** button when the step failed (re-runs `commitRun`, idempotent).
- **User edits** and approved proposals commit with `author:'user'` under the same optimistic `baseVersion` check (409 on mismatch). Delete is a tombstone version.

## Concurrency across simultaneous runs of a channel

| Case                                               | Behaviour                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Two runs append `story.episodes`                   | Both commit; indexes in commit order. No conflict.                                                            |
| Two runs replace `story.digest` from the same base | First commits; second becomes `conflict` (UI: base/theirs/mine; **Keep mine / Keep theirs / Edit and save**). |
| A user edits while a run is in flight              | The run's commit sees a new base -> `conflict`.                                                               |
| A run reads while another commits                  | Unaffected (`asOf`).                                                                                          |

## Validator (pure; `BlueprintService` loads a `channelMemoryKeys: Map<key,{schema,type}>` snapshot like `assetsById`)

**Errors:** `persist` on a non-text/data output; persist path unresolvable in the output schema; `#` in a persist key; two stages persisting the same key with `mode:'replace'` (unless dependency-ordered, after Phase 11); a list read without `limit`; a `channelMemory` read bound to a `required:true` slot or used in a template path without `fallback` (may be absent on the first run, §16.2); a template path into a key whose schema is unknown (only whole-value `{{ name }}` allowed then).
**Warnings:** a read key that doesn't exist in the channel and isn't persisted by this blueprint; `review:'auto'` on `lesson`/`preference`; list `limit` above 50.

## Long-form needs (the 2–3 hour target)

Hierarchical summarization is a **blueprint pattern** on this table, not engine magic. Per episode, a final `text.generate` stage reads `story.digest` and the episode's script/timeline from Run Memory and outputs `{episodeSummary, newDigest, openThreads[], characterChanges[]}`, persisting `story.episodes` (append), `story.digest` (replace; stays bounded because rewritten each time), `story.threads` (replace, `state`), `character.<id>.state` (replace, `state`). Within a movie run, scene -> sequence -> act summaries are **Run Memory** (iterate + writes); only the final film digest is persisted. Later, once patterns settle: a built-in `memory.summarize` capability; pgvector only if FTS recall measurably fails (cost: apt package in the image, `RUNTIME_VERSION` bump, dev/CI Postgres swap).

## Module, API, orchestration

- New Nest module `apps/api/src/channel-memory/` (`ChannelMemoryModule`: service, controller, tests); imports `DbModule` explicitly. The artifact module (resolver) and orchestration import it. It must not import `run`/`blueprint` modules (cycles); it reads `run`/`stage_attempt` through Drizzle as `run-seed.ts` does. `CapabilityModule` untouched.
- Endpoints (DTOs via `ZodValidationPipe`): `GET /channels/:id/memory?prefix&tag&q&status&blueprintId`; `GET /channels/:id/memory/keys/:key/history`; `PUT /channels/:id/memory/keys/:key`; `DELETE /channels/:id/memory/keys/:key?baseVersion=`; `POST /channels/:id/memory/proposals/:entryId/decide`; `GET /runs/:id/memory` (what the run read at `asOf`, proposed, committed); `POST /runs/:id/memory/commit`.

## Web

- **Channel -> Memory tab** (beside Characters and Assets): keys grouped by prefix; type/tag filters; full-text search; per-entry summary, value, version history, provenance link (run/stage/attempt; "run deleted" when `run_id` null); Edit/Delete/Add; **Pending** sub-tab (approve, reject, edit-then-approve, resolve conflict, **Approve all from this run**).
- Stage inspector -> Output & memory writes: **Save to channel memory** (key, mode, type, tags, summary field, scope, review).
- `BindingPicker`: **Channel memory** source (key autocomplete from the API, list options, fallback).
- Run page: **Channel memory** panel (read as-of, entries read per stage, proposed/committed, **Commit memory**).

## Assistant

New read tool `get_channel_memory` (keys with type, tags, summary, size; values only by key). New guide topic `memory` (Run Memory vs Channel Memory, `persist`, fallbacks, digest pattern, review default). Recipe "Series episode with continuity" validated by `guide.test.ts` (the Ref coverage test forces `channelMemory` into the guide). The assistant **cannot write memory entries** (matches "You can't create Characters", `guide.ts:159`).

## Packages and privacy

Memory values are **never exported**. `persist` and `channelMemory` refs travel as keys (`findPrivacyFlags`, `package-privacy.ts:10`, already scans keys and `fallback` constants in the pipeline). Add optional `requires.memoryKeys?: string[]` to the manifest ("this pipeline reads story.digest (starts empty)"); `PACKAGE_FORMAT_VERSION` stays 1. A later opt-in "starter memory" bundle would run `findPrivacyFlags` over values and default to off; not v1.

## Relationship to Run Memory

```
                 ┌───────────────────────── one run ──────────────────────────┐
 channel_memory  │  start: run.memory_as_of_seq = max(seq)                     │
 (committed,     │                                                             │
  seq ≤ asOf) ───┼──► {from:'channelMemory'} ──► stage S reads ──► provenance  │
                 │        (external, like an asset; never in §15.2 closure)    │
                 │  stage A ──writes──► run_memory (versions, tombstones,      │
                 │                       key#i) ──{from:'memory'}──► stage B   │
                 │                       ▲ invalidation via recorded reads     │
                 │  stage P (persist: …) — nothing written during the run      │
                 └───────────────┬─────────────────────────────────────────────┘
                                 │ run COMPLETED (not dry, not failed/cancelled)
                                 ▼ commitRun: active artifacts of persisting stages
                 review:auto  ──► committed (version++, optimistic base check → conflict)
                 review:human ──► pending ──approve/edit──► committed  |  reject ──► rejected
 next run ◄── reads committed entries as of its own start
```

## Steps (one commit each; one PR `feat: persistent channel memory`, branch `feat/channel-memory`)

1. `feat(shared)`: channel memory schemas, `persist`, the `channelMemory` Ref (+ guide Ref coverage).
2. `feat(api)`: `channel_memory` table, `run.memory_as_of_seq`, delete cascade (migration 0037 + all three cascade sites + cascade e2e).
3. `feat(api)`: channel memory service with as-of reads, search and optimistic writes (unit incl. conflict matrix).
4. `feat(api)`: pin memory at run start; resolve `channelMemory` refs; provenance; seed stop reason `memory_changed`.
5. `feat(api)`: validate `persist` and channel memory reads.
6. `feat(api)`: commit persisted memory when a run completes (orchestration step, idempotency, dry-run/draft rules, notification, `POST /runs/:id/memory/commit`).
7. `feat(api)`: channel memory endpoints.
8. `feat(web)`: Memory tab, proposals review, persist editor, run memory panel.
9. `feat(api)`: assistant tool, guide topic, series recipe.
10. `feat(api)`: keep memory out of packages; list read keys in the manifest.
11. `docs`: `apps/docs/docs/channels/memory.md` (new slug), `blueprints/connecting-stages.md`, `runs/run-page.md`, `blueprints/sharing.md`, glossary; spec new §3.14 `channel_memory`, §6.7 "Channel Memory", §6.1 Ref, §15.1 (refresh trigger if adopted), §16.2/16.3, §19 (pinned by `memory_as_of_seq`), §26.3, §28; **ADR-0016** "Persistent channel memory: declared persist, commit on completion, FTS not vectors".
12. _(Optional, Q7)_ `feat(api)`: offer human rejection notes as pending lessons — `commitRun` turns this run's `stage_attempt.review_note`s into `pending` `lessons.review#n` entries (type `preference`, tags `[capability, stageKey]`). Deterministic, no LLM, always human-reviewed.

## Tests

- **Unit:** as-of read semantics (tombstone at latest, blueprint-scope shadowing, group ordering, `limit`/`order`, FTS ranking); version assignment under a simulated `23505`; conflict detection replace vs append; `commitRun` idempotency incl. re-completion adding only changed artifacts; validator matrix; privacy (exported pipeline contains keys only).
- **E2E:** `channel-memory.e2e.test.ts` (episode 1 completes -> `story.episodes#0` and `story.digest` committed; episode 2 reads them, provenance records entry ids/versions; FAILED, CANCELLED and dry runs commit nothing; `review:'human'` produces pending entries invisible to reads until approved). `channel-memory-concurrency.e2e.test.ts` (two runs from the same base both replacing `story.digest`: first commits, second `conflict`; both appends commit; a run started before a commit keeps reading the old value on retry). Seeding: reused stage whose memory read went stale stops with `memory_changed`.

## Delete-cascade obligations (CLAUDE.md)

`channel_memory` has FKs to `channel`, `blueprint` and `run`; all three sites change.

1. **`deleteRunsCascade`** (`run/run-cascade.ts:30-75`): before `tx.delete(run)` (`:73`) `UPDATE channel_memory SET run_id = NULL WHERE run_id IN runIds AND status = 'committed'` (memory outlives the run; `source.runId` keeps the audit trail) and `DELETE FROM channel_memory WHERE run_id IN runIds AND status <> 'committed'` (pending/rejected/conflict). Update the doc comment. **Interaction with Phase 16:** child runs are deleted first (recursion), same statements apply per batch.
2. **`BlueprintService.delete`** (`blueprint/blueprint.service.ts:170-210`): delete `channel_memory WHERE blueprint_id = id` after `deleteRunsCascade`, before the blueprint delete.
3. **`ChannelService.delete`** (`channel/channel.service.ts:143-235`): delete `channel_memory WHERE channel_id = id` **before** `deleteRunsCascade` (`:187`) so no FK into `run`/`blueprint` remains; update the ordering comment (`:132-141`).
4. **E2E** `channel-delete-cascade.e2e.test.ts`: seed channel-scoped, blueprint-scoped and pending rows in both tests (`:205` blueprint delete; `:313` full channel); blueprint delete removes only blueprint-scoped and pending rows of its runs and nulls `run_id` on channel-scoped committed rows; channel delete removes all. Also extend the run-deletion e2e (`library-delete.e2e.test.ts`) for the null-out.
5. **Storage:** no blobs referenced (no media in v1) so no `queueStorageOrphans`. State this in the table's doc comment so a future media addition knows it must add one.

## Risks

- **Memory poisoning compounds across episodes:** default `review:'human'`; draft runs always pending; full history plus revert; provenance on every entry.
- **Prompt bloat:** required `limit`, size telemetry, digest pattern; no hidden truncation.
- **FTS quality is lexical** (`simple` dictionary, language-agnostic): fine for keys/tags/named entities; semantic recall is a measured follow-up.
- Re-completion semantics may surprise: UI labels superseded entries; docs explain.
- The `search` column over `data::text` can be large for big JSON: acceptable at channel scale; revisit with `left(…, N)` (documented ceiling).

## Open decisions (default in bold)

5. Default `review` for `persist`: **`human`, with one-click "Approve all from this run".**
6. Turn human rejection notes into pending "lesson" entries (step 12): **opt-in per blueprint**; QC critiques not included (noisier).
7. Auto-inject a bound Character's channel-memory `state` into the identity prompt, or explicit? **Explicit.**
8. Run-page "Refresh channel memory" action (new invalidation trigger)? **Not in v1.**
9. Is `blueprint_id` scope enough for "series", or a first-class Series entity spanning blueprints? **`blueprint_id` scope for now.**
10. Canvas/draft runs may create **pending** memory only, never auto-commit? **Yes.**
11. Memory in packages: **keep values out entirely**; opt-in "starter memory" bundle later.
12. (New) Do child runs (Phase 16) honour their blueprint's `persist`? **No; the parent stage's `persist` on the child's output is the supported path** (avoids N pending proposals per outer item).
