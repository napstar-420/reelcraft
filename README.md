# Reefcraft

A general-purpose AI video/reel generation engine. See `docs/ai-reel-engine-requirements.md`
and `docs/ai-video-engine-design-spec-v6.md` for the full requirements and design spec — this
repo implements Build Order Phase 1 ("Skeleton") from design spec §24.

## Stack

TypeScript end to end · NestJS (`apps/api`) · React + Vite (`apps/web`) · Postgres + Drizzle ·
Inngest (self-hosted, `inngest start`) · MinIO (S3-compatible blob storage) · Zod.

## Processes & ports

| Process | Port | Notes |
|---|---|---|
| API (NestJS) | `:3000` | REST + SSE, `/api/inngest` |
| Web (Vite) | `:5173` | Proxies `/api` → `:3000` in dev |
| Postgres | `:5432` | Two databases: `reefcraft` (engine) and `inngest` |
| MinIO | `:9000` (API) / `:9001` (console) | |
| Inngest | `:8288` | Runs via `inngest start`, **not** `inngest dev` — the dev server's state is ephemeral and would not survive a restart mid-video-job |

## Fresh clone setup

```bash
cp .env.example .env
docker compose up -d          # postgres (2 dbs), minio (+bootstrap), inngest
pnpm install
pnpm db:migrate
pnpm dev                      # api :3000 + web :5173
```

Open http://localhost:5173, create a channel, instantiate the seeded "Hello Stage" template,
start a run, and watch it reach `COMPLETED` against the fake provider (zero cost, no API key
needed).

## Repo layout

```
apps/
  api/      NestJS backend — engine core, Drizzle schema, Inngest orchestration
  web/      React + Vite frontend — minimal shell (channels → instantiate → run → watch)
packages/
  shared/   Zod schemas shared by api and web (StageDef, Ref, ConfigLayer, DTOs, ...)
docker/     Postgres init script, MinIO bootstrap script
```

## Commands

```bash
pnpm dev              # run api + web
pnpm typecheck        # tsc -b across the whole workspace
pnpm lint             # eslint
pnpm test             # unit tests (packages/shared; apps/api unit tests are a follow-up)
pnpm db:generate      # drizzle-kit generate (after schema changes)
pnpm db:migrate       # apply migrations
pnpm db:studio        # drizzle studio
```

## What's implemented (Phase 1 — Skeleton)

- `packages/shared`: every type from the design spec's Appendix A as Zod schemas, with unit
  tests covering the fiddly parsers (`ConfigLayer` nullish semantics, `Ref` discrimination,
  the restricted `JsonSchema` dialect, a `StageDef` round-trip).
- `apps/api`: full Drizzle schema for all 13 tables in §3, all 14 Nest modules from §1.3,
  `StorageAdapter` (MinIO via `@aws-sdk/client-s3`, `forcePathStyle: true`), a first-class
  `FakeProviderAdapter` with injectable failure modes plus an `OpenRouterAdapter`, the
  `llm.generate` capability, Inngest orchestration (`run.orchestrate` → `stage.execute`) via
  the DI factory pattern, artifact finalization with the born-stale/stale-before-insert
  ordering the partial unique index requires, and the phase-1 API surface (channels,
  blueprints, templates, runs, capabilities, SSE run events).
- `apps/web`: channels list/create → instantiate the builtin template → start a run → watch
  its state and stage executions update live.
- `docker-compose.yml`: Postgres (two databases), MinIO with a bootstrap sidecar, Inngest via
  `inngest start`.

**Verified end to end**, against the real stack (Docker Desktop, real Postgres/MinIO/Inngest,
no mocks): `docker compose up` → `pnpm db:migrate` → API boot → `POST /channels` →
`POST /templates/:id/instantiate` → `POST /runs` → Inngest picks up `run/started`, runs
`run.orchestrate` → `stage.execute` against the real self-hosted Inngest server → the
`FakeProviderAdapter` → artifact finalized (`stale: false`) → ledger entry recorded
(`$0.0010`) → raw response written to MinIO at the correct
`{ownerId}/{channelId}/{runId}/raw/{attemptId}.json` key → run reaches `COMPLETED`. Also
verified: `pnpm typecheck`, `pnpm lint`, `pnpm test` (`packages/shared`), `nest build`,
`vite build`.

**Not yet verified:** the durability check (killing/restarting the API mid-run), and a real
run against OpenRouter (needs a funded key).

## Known gotchas (see design spec for full context)

- **`blueprint` ↔ `blueprint_version` FK cycle** (§3.4): `blueprint.current_version_id` has no
  FK in the initial migration; `drizzle/0001_blueprint_current_version_fk.sql` adds it as a
  documented follow-up.
- **`artifact_active_uq`** (§3.9): a partial unique index that cannot be `DEFERRABLE`. Every
  artifact-superseding write must mark the old row stale *before* inserting the new one, in one
  transaction — see `ArtifactService.finalize()`.
- **`forcePathStyle: true`** is mandatory for the MinIO `StorageAdapter` — the AWS SDK defaults
  to virtual-host addressing, which needs wildcard DNS local MinIO doesn't have.
- **`DbModule` is deliberately not `@Global()`**, unlike what §1.3's prose literally says,
  because the spec also says `CapabilityModule` must not be able to reach it — those two
  statements can't both hold under Nest's DI model. Modules that need the `DRIZZLE` token
  import `DbModule` explicitly.
- **Money columns** (`numeric(12,4)`) round-trip as strings through `drizzle-orm`'s
  `postgres-js` driver — always go through `common/money.ts`'s `toUsd`/`fromUsd`, never
  `Number()` directly.
- **CommonJS, not ESM**, across `apps/api` and `packages/shared` — this was a deliberate switch
  made during setup (not in the original plan) after `drizzle-kit generate` couldn't resolve
  the NodeNext-style `.js`-suffixed relative imports across the schema files. `apps/web` is
  unaffected (Vite handles its own module resolution for the browser).
- **Inngest + Redis**: resolved — the pinned `inngest/inngest` image logs
  `"starting event stream","backend":"redis"` on boot, using an embedded Redis-compatible
  store automatically. No separate `redis` compose service needed.
- **`minio/minio` and `minio/mc` no longer pull from Docker Hub** without login — MinIO moved
  their official images to `quay.io/minio/minio` and `quay.io/minio/mc`. `docker-compose.yml`
  uses the `quay.io` images.
- **Postgres init scripts must be executable.** `docker-entrypoint.sh` execs
  `/docker-entrypoint-initdb.d/*.sh` directly rather than sourcing them; a non-executable
  script fails with a cryptic `bad interpreter: Permission denied`, which silently skips DB
  creation and leaves the container in `Exited (126)`. Both init scripts are checked in with
  the executable bit set — if you edit them, re-`chmod +x`.
- **`INNGEST_SIGNING_KEY` must be a bare hex string with an even number of characters** — no
  `signkey-` prefix, no other formatting. Generate one with `openssl rand -hex 32`. The same
  value must be set in `docker-compose.yml` (for the `inngest` service) and in `.env` (for the
  API, which signs/verifies against it).
- **AWS SDK v3 + MinIO 501s on CORS/bucket calls** — newer `@aws-sdk/client-s3` versions default
  `requestChecksumCalculation`/`responseChecksumValidation` to `WHEN_SUPPORTED`, sending a
  checksum header MinIO's S3 API rejects with `501 NotImplemented`. Fixed by setting both to
  `WHEN_REQUIRED` in `storage/s3-client.factory.ts`, which both `S3StorageAdapter` and
  `BucketBootstrapService` now share. `BucketBootstrapService` also no longer lets a failure
  here crash the whole app (an `OnApplicationBootstrap` rejection is otherwise fatal) — it logs
  a warning and relies on the `mc` bootstrap sidecar in `docker-compose.yml` instead.
- **`express` must be a direct dependency of `apps/api`**, not just a transitive dependency of
  `@nestjs/platform-express` — pnpm's strict `node_modules` isolation blocks requiring
  undeclared "phantom" dependencies, and `main.ts` imports `express` directly for its body-size
  middleware.
- **`@UsePipes()` at the method level applies to *every* parameter, not just `@Body()`.**
  `ChannelController.create` and `BlueprintController.createVersion` originally applied
  `ZodValidationPipe(SomeDto)` via `@UsePipes()` alongside an `@Owner()`/`@Param()` argument —
  the pipe ran against that plain string too and failed validation. Fixed by scoping the pipe
  to the body parameter directly: `@Body(new ZodValidationPipe(Dto))`.
- **Zod's `discriminatedUnion` requires the discriminator value to be unique across every
  branch.** `JobStatus` originally used `z.discriminatedUnion('done', ...)` with two branches
  both keyed `done: true` (`succeeded` vs. `failed`, distinguished only by `outcome`) — Zod
  throws at schema-construction time, which crashed the process on boot since it happens at
  module load. Fixed by using a plain `z.union([...])` instead.
- **A stale `tsconfig.tsbuildinfo` can make `tsc`/`nest build` silently under-emit.** After
  editing `tsconfig.base.json` (the ESM→CommonJS switch), rebuilding without first deleting
  `*.tsbuildinfo` left several `apps/api/src/*` directories (`capability/`, `config/`,
  `provider/`, `storage/`, etc.) missing from `dist/` entirely, with no build error — `nest
  start` only surfaced it as a runtime `Cannot find module`. If a build looks incomplete after
  a tsconfig change, `rm -rf dist *.tsbuildinfo` and rebuild clean before debugging further.

## Follow-ups not done in this pass

- The one-stage blueprint was proven end to end **manually** (see above), but there is no
  automated test for it yet. The plan calls for a `finalize()` ordering test, a
  `CapabilityModule` standalone-boot test proving `DbModule` isolation, and an e2e run of the
  one-stage blueprint via an inline fake Inngest step driver — none of that is written yet.
- CI only runs typecheck/lint/unit tests for `packages/shared`; no e2e job yet (would need
  Postgres/MinIO as GitHub Actions services, plus the inline step driver above so it doesn't
  depend on a live Inngest process).
- The durability check (kill/restart the API mid-run, confirm no second provider job is
  submitted) hasn't been run.
- `eslint.config.mjs`'s shared-package import-boundary rule is scoped slightly too broadly
  (applies repo-wide rather than only under `packages/shared/**`) — harmless in practice since
  no import specifier in this codebase literally contains `apps/`, but worth tightening.
