# Reelcraft

A general-purpose AI video/reel generation engine. See `docs/ai-reel-engine-requirements.md`
and `docs/ai-video-engine-design-spec-v6.md` for the full requirements and design spec — this
implementation currently covers Build Order Phases 1–9.5 (`docs/build-progress.md`), including
the inputs/human-in-the-loop control plane, media storage/providers, assembly with a browser
timeline editor, sequential iteration, channel Characters, the capability-driven editor and
template library, and a drag/drop visual Blueprint canvas, from design spec §24. Phase 10
(Socket.IO live updates) is the only pending phase.

Reelcraft also runs as a single self-hosted Docker container, with no repo clone or
toolchain needed. See [Run with Docker](#run-with-docker-self-hosted).

## Run with Docker (self-hosted)

One image runs the whole app: the API, web UI, Postgres, MinIO and Inngest. Everything you
create is stored in one volume mounted at `/data`.

**The step-by-step guide for users is at
[napstar-420.github.io/reelcraft/docs](https://napstar-420.github.io/reelcraft/docs/)**:
installing Docker Desktop on Windows, macOS or Linux, running Reelcraft, provider keys,
BrowserOS Neo, Connect Codex, updating, backups and troubleshooting. Its source is
[`apps/docs`](apps/docs/README.md). The quick version:

```bash
docker run -d --name reelcraft --restart unless-stopped \
  -p 8080:8080 -v reelcraft-data:/data zohaibkhan97/reelcraft
```

Then open http://localhost:8080. In Docker Desktop, search for `zohaibkhan97/reelcraft`, click
**Run**, and under **Optional settings** set host port `8080` and volume `reelcraft-data` →
`/data`.

Releases are published to Docker Hub (`zohaibkhan97/reelcraft`, searchable in Docker Desktop)
and to `ghcr.io/napstar-420/reelcraft`, for both Intel/AMD (`amd64`) and Apple Silicon (`arm64`).
Tags: an exact version (`1.4.2`), the latest patch of a minor (`1.4`) or major (`1`), and
`latest`. Release notes are on [GitHub Releases](https://github.com/napstar-420/reelcraft/releases).

**What's in `/data`:**

| Path                | Contents                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/data/postgres`    | Postgres 16 (`reelcraft` and `inngest` databases)                                                                     |
| `/data/minio`       | Media files                                                                                                           |
| `/data/workspace`   | Render and Codex job folders                                                                                          |
| `/data/codex`       | Codex CLI home (`CODEX_HOME`): login, config, skills                                                                  |
| `/data/app`         | App updates installed from inside the app                                                                             |
| `/data/backups`     | Database backups taken before each in-app update                                                                      |
| `/data/secrets.env` | Passwords and keys generated on first start, including the one that unlocks provider keys saved in Settings. Keep it. |

**Container environment variables** (all optional): provider keys (`OPENROUTER_API_KEY`,
`FAL_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`) take priority over keys saved in
**Settings**; `CODEX_BROWSER_OS_URL` sets the default BrowserOS Neo address
(`http://host.docker.internal:9010/mcp` in the image), which an address saved in Settings
replaces; `SETTINGS_ENCRYPTION_KEY` overrides the key derived from `/data/secrets.env`;
`REELCRAFT_UPDATES=off` turns update checks off. On Linux without Docker Desktop, start the
container with `--add-host=host.docker.internal:host-gateway` so it can reach Neo.

**Security.** There is no login. Anyone who can reach the port can use the app and your
provider keys. Keep it on your own computer or a trusted network, and don't expose it to the
internet.

**Known limitations.**

- Deepgram transcription needs Deepgram to reach the instance (`PUBLIC_API_BASE_URL`), so it
  doesn't work on a desktop install.
- The image is large (Chromium, FFmpeg, Postgres and Codex are included). You download it once
  per image update; most updates install from inside the app instead.

### Building the image

```bash
docker build -f docker/app/Dockerfile --build-arg REELCRAFT_VERSION=0.1.0 -t reelcraft:dev .
docker run -d --name reelcraft -p 8080:8080 -v reelcraft-dev-data:/data reelcraft:dev
docker logs -f reelcraft          # every service logs to the container's output
```

On every start, Inngest logs `rejecting event; event key not recognized` and a `traces export`
404 once. Both come from the Inngest server itself (it does this with no app running) and are
harmless.

The runtime is Ubuntu 24.04, which provides Postgres 16 and FFmpeg from its own archive. MinIO
now publishes source only, so the build compiles a pinned commit (AGPLv3). Inngest comes from
its official image, and Remotion's Chrome Headless Shell is installed at build time.

[s6-overlay](https://github.com/just-containers/s6-overlay) supervises the services, defined in
`docker/app/rootfs/etc/s6-overlay/s6-rc.d/`:

| Service            | Kind    | Does                                                                           |
| ------------------ | ------- | ------------------------------------------------------------------------------ |
| `init-data`        | oneshot | Creates `/data` folders, generates `secrets.env`, initializes Postgres         |
| `postgres`         | longrun | Postgres 16 on `127.0.0.1:5432`                                                |
| `minio`            | longrun | MinIO on `127.0.0.1:9000`, reached by the browser through the API's `/storage` |
| `update-reconcile` | oneshot | Rolls back an in-app update that a container restart interrupted               |
| `migrate`          | oneshot | Applies database migrations; the container stops if this fails                 |
| `inngest`          | longrun | `inngest start` on `127.0.0.1:8288`, state in the `inngest` database           |
| `update-agent`     | longrun | The in-app updater (root), on the `/run/reelcraft/updater.sock` Unix socket    |
| `api`              | longrun | API + web UI on `:8080`; applies its own migrations before starting            |

Only port 8080 is exposed. The image sets `WEB_DIST_DIR` (serve the built web app) and
`S3_BROWSER_PATH_PREFIX=/storage` (browser media URLs go through the API instead of to MinIO);
leave both unset in local dev. To start from scratch, remove the container and run
`docker volume rm reelcraft-dev-data`.

`docker/app/smoke-test.sh <image>` boots an image on a fresh volume, runs the seeded
"Hello Stage" template to completion and round-trips a file through `/storage`. CI runs it on
every push and before every release.

**In-app updater.** The update agent lives in the image
(`docker/app/rootfs/usr/local/lib/reelcraft/updater/`), not in the app bundle, so a downloaded
update can never change how updates are verified. It runs as root and owns `/data/app`; the API
(user `reelcraft`) only relays the user's requests to it (`apps/api/src/update/`).

1. It lists GitHub Releases, then downloads the newest release's manifest and checks the
   manifest's signature against the image's `/opt/reelcraft/release-signing.pub`.
2. It downloads this architecture's bundle, checks its size and SHA-256 against the manifest,
   and unpacks it into `/data/app/versions/X.Y.Z`.
3. It backs up the database with `pg_dump`, records the update as a _trial_ in
   `/data/app/state.json`, and restarts only the `api` service.
4. `select-app.mjs` points the `api` and `migrate` services at the right bundle (trial, then
   installed update, then the image's own bundle). The API applies that bundle's migrations and
   starts.
5. When the API reports healthy on the new version, the trial becomes the active version.
   Otherwise, after 5 minutes, the agent stops the API, restores the backup, and starts the
   previous version.

`docker/app/update-test.sh <image>` exercises all of this in CI. It publishes releases made from
the image's own bundle on a fake GitHub API, signed with a throwaway key, then installs a good
update and a broken one and checks that the broken one rolls back. `pnpm test:release` runs the
agent's unit tests. Development builds (versions like `dev`) never update. For testing, the
agent also reads `REELCRAFT_UPDATE_API`, `REELCRAFT_UPDATE_REPO` and
`REELCRAFT_UPDATE_TRIAL_TIMEOUT_SEC`.

## Releasing

Versions come from the conventional commit subjects merged to `main`.
[release-please](https://github.com/googleapis/release-please) keeps a
`chore(main): release X.Y.Z` PR open with the version bump and `CHANGELOG.md`: `feat` bumps
the minor version, `fix` the patch (while below 1.0, breaking changes bump the minor). **Merging
that PR is the release.** `.github/workflows/release.yml` then:

1. tags `vX.Y.Z` and creates the GitHub Release;
2. builds the image natively for `amd64` and `arm64`, and smoke-tests each;
3. publishes the multi-arch image to GHCR and Docker Hub as `X.Y.Z`, `X.Y`, `X` and `latest`
   (prereleases get only their exact tag);
4. attaches `reelcraft-app-X.Y.Z-linux-<arch>.tar.gz` bundles, copied out of the published
   images, plus a signed `reelcraft-X.Y.Z.manifest.json` that the in-app updater verifies;
5. syncs `docker/app/DOCKERHUB.md` to the Docker Hub page.

If a release job fails, fix the cause and use **Re-run failed jobs**; the tag already exists.

**Runtime version.** An in-app update swaps only the app bundle and keeps the user's image, so
the image is versioned separately in `docker/app/RUNTIME_VERSION`. Bump it in any PR that
changes what the image contains (`docker/app/Dockerfile`, `docker/app/rootfs/`, including the
updater), or the `@remotion/renderer` version (the image installs the browser for it). The
`Runtime version` check enforces this. Releases whose runtime is newer than a user's image are
shown as "update the image" instead of installing in-app. Add the `runtime-unchanged` label for image edits that
can't affect the running container, such as comments.

**One-time setup** (repository settings):

1. **Signing key:** run `node scripts/release/keygen.mjs` on your own machine. Commit the
   `docker/app/release-signing.pub` it writes, and paste the printed private key into the
   `RELEASE_SIGNING_KEY` Actions secret. Keep a backup: replacing the key stops older installs
   from verifying new releases.
2. **Docker Hub:** create the repository, then add the `DOCKERHUB_IMAGE` Actions variable
   (e.g. `yourname/reelcraft`) and the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets. The
   token needs Read, Write and Delete scope so the description can be updated. Without these,
   releases go to GHCR only.
3. **Actions → General:** allow GitHub Actions to create and approve pull requests
   (release-please opens the release PR).
4. **After the first release:** make the `reelcraft` package public under your GitHub profile's
   Packages. GHCR creates it as private.

**Stacked PRs.** Large changes ship as a stack of PRs, each based on the previous one's branch,
and merge bottom-up. After a lower PR is squash-merged, rebase the next branch onto `main`
(`git rebase --onto origin/main <old-base-branch>`), force-push it with `--force-with-lease`,
and retarget its PR to `main`.

## Stack

TypeScript end to end · NestJS (`apps/api`) · React + Vite (`apps/web`) · Postgres + Drizzle ·
Inngest (self-hosted, `inngest start`) · MinIO (S3-compatible blob storage) · Zod.

## Processes & ports

For local development. The self-hosted image runs the same processes inside one container and
exposes only `:8080` (see [Building the image](#building-the-image)).

| Process      | Port                              | Notes                                                                                                                               |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API (NestJS) | `:3000`                           | REST + SSE, `/api/inngest`                                                                                                          |
| Web (Vite)   | `:5173`                           | Proxies `/api` → `:3000` in dev                                                                                                     |
| Postgres     | `:5432`                           | Two databases: `reelcraft` (engine) and `inngest`                                                                                   |
| MinIO        | `:9000` (API) / `:9001` (console) |                                                                                                                                     |
| Inngest      | `:8288`                           | Runs via `inngest start`, **not** `inngest dev` — the dev server's state is ephemeral and would not survive a restart mid-video-job |

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

## Local Codex provider

`text.generate` stages may select the `codex` provider when the API runs on a macOS workstation
with an installed, authenticated Codex CLI. Reelcraft discovers the current visible model catalog
and each model's supported reasoning efforts through `codex app-server`; it does not hard-code the
catalog. The selected effort is stored in `model.params.reasoningEffort`. Other params become raw
dotted `codex exec -c key=<TOML value>` overrides, while Reelcraft keeps model, effort, working
directory, approval policy, output files/schema, and ephemeral execution authoritative.

Jobs run outside this repository under `WORKSPACE_ROOT/codex-jobs`. They inherit the API process
owner's Codex login, configuration, skills, plugins, and MCP servers, including BrowserOS Neo when
the user has enabled it. Failures to authenticate, connect BrowserOS, satisfy automatic approval,
or run the selected model fail the stage; there is no fallback provider. Local ChatGPT-authenticated
CLI usage settles at `$0` because it has no dependable per-call USD price.

In the self-hosted image, the CLI runs inside the container with `CODEX_HOME=/data/codex`, so
its login and configuration live in the data volume rather than in your home folder. **Settings
→ Codex → Connect Codex** signs it in (`codex login --device-auth`, with BrowserOS Neo entering
the code) and adds a `browseros-neo` MCP server pointing at the Neo address from Settings. It
never changes an entry you configured yourself.

This provider is intentionally local and single-user. A production or multi-user deployment must
isolate Codex accounts, job workers, BrowserOS profiles, and filesystem/process permissions per
user. **Unattended BrowserOS stages are high risk:** prompts can mutate signed-in external accounts,
and Reelcraft's USD budget controls do not constrain purchases, deletions, messages, or other
external actions. Test browser-capable stages only with disposable accounts and sites.

After reviewing the prompt and account risk, run the opt-in local acceptance check with:

```bash
REELCRAFT_CODEX_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:codex
```

## Repo layout

```
apps/
  api/      NestJS backend — engine core, Drizzle schema, Inngest orchestration
  render-worker/ Remotion render process used by durable compute jobs
  web/      React + Vite frontend — minimal shell (channels → instantiate → run → watch)
  docs/     User guide (Docusaurus) on GitHub Pages; outside the pnpm workspace
packages/
  shared/   Zod schemas shared by api and web (StageDef, Ref, ConfigLayer, DTOs, ...)
  timeline-composition/ Shared Remotion composition for preview and final render
design/     Design tokens and static HTML previews backing docs/design-system.md
docker/     Postgres init script, MinIO bootstrap script (dev compose)
  app/      Self-hosted image: Dockerfile, s6 services, smoke test, Docker Hub page
scripts/
  release/  Release manifest build, signing and key generation
```

See `docs/design-system.md` ("Night Studio") for the web app's design tokens and component
rules — `apps/web` uses Tailwind CSS v4 and shadcn/ui with light/dark mode.

## Commands

```bash
pnpm dev              # run api + web
pnpm typecheck        # tsc -b across the whole workspace
pnpm lint             # eslint
pnpm test             # unit tests (packages/shared, apps/api)
pnpm test:e2e         # apps/api e2e tests — needs `docker compose up` (real Postgres)
pnpm test:release     # release manifest signing tests (node:test)
pnpm db:generate      # drizzle-kit generate (after schema changes)
pnpm db:migrate       # apply migrations
pnpm db:studio        # drizzle studio
```

The user guide in `apps/docs` installs and builds on its own (it isn't in the workspace):
`cd apps/docs && pnpm install --ignore-workspace && pnpm start`. See
[`apps/docs/README.md`](apps/docs/README.md).

## Phase 6 assembly prerequisites

The self-hosted image already includes FFmpeg and Chrome Headless Shell; these prerequisites
apply when running on your own machine.

Install FFmpeg (both `ffmpeg` and `ffprobe`) plus Chrome/Chromium. Assembly
supports the async `video.concat` and `timeline.render` capabilities and the
sync `subtitles.export` capability. A `human.timeline_edit` stage opens the
browser editor, whose preview and server renderer share the same Remotion
composition. Set `REMOTION_BROWSER_EXECUTABLE` if Remotion cannot discover the
browser automatically.

Run the local-only uploaded-input render acceptance with:

```bash
pnpm --filter @reelcraft/api acceptance:phase6-render
```

The command builds the render worker, creates an input clip, renders a timeline,
and verifies the resulting MP4 with `ffprobe`. It is intentionally not part of
CI because it requires system media and browser dependencies.

## Phase 7 iteration prerequisites

Install FFmpeg (`ffmpeg` and `ffprobe`). Iteration adds the `iterate` stage
shape — sequential per-item execution with the `prevItem` carry and its
ffmpeg-backed `lastFrame`/`firstFrame` derived-frame shortcut.

Run the local-only broll derived-frame acceptance with:

```bash
pnpm --filter @reelcraft/api acceptance:phase7-broll
```

The command builds a synthetic video fixture, drives a 3-item `video.generate`
iterating stage, and verifies `{from:'prevItem', path:'lastFrame'}` really
extracts and caches a frame via `ffmpeg`. It is intentionally not part of CI
because it requires a system `ffmpeg` binary.

## Phase 5 media prerequisites

Install FFmpeg so `ffprobe` is on the API process `PATH`. Media runs store a
normalized probe, stream generated output to MinIO, and expose live objects at
`GET /api/blobs/:id` through short-lived redirects; collected objects return
`410`. Real provider pins are optional: OpenRouter image generation, ElevenLabs
speech, and fal's `fal-ai/kling-video/v3/standard` video queue use the matching
environment key. Video defaults to requiring an audio stream unless its output
constraint explicitly selects `optional` or `forbidden`. Real-provider calls
should be run locally with explicit funded keys; the normal test suite is free.

## Characters

Characters are reusable channel assets. Create one with `POST
/api/channels/:channelId/characters`, request and confirm reference-image
uploads under `/api/characters/:id/references`, or promote an active generated
image with `POST /api/characters/:id/references/promote`. A one-role blueprint
stores its selected Character and ordered reference blob IDs. Starting a run
snapshots those references before any provider work; changing or deleting a
Character later cannot alter an existing run. LoRA training is not yet part of
the product.

Targeted fake-media runner coverage requires Docker Postgres and can be run with:

```bash
pnpm --filter @reelcraft/api exec vitest run -c vitest.e2e.config.ts test/e2e/media-output.e2e.test.ts
```

It uses deterministic fixtures and a test probe so CI does not require FFmpeg.
Before enabling real media, verify the host dependency directly with
`ffprobe -v error -show_format -show_streams path/to/media-file`.

## Phase 4 run-control workflow

Runs are created in `CREATED`, inputs/assets are attached, and
`POST /runs/:id/start` commits a revision-bound `run/started` wakeup. Operator
mutations use a durable Postgres outbox, so a temporary Inngest delivery failure
does not lose a committed action. Useful endpoints include:

- `GET /runs/:id/memory` and `GET /runs/:id/invalidation-preview?stageKey=...`
- `POST /runs/:id/stages/:key/retry`, followed by `/retry/confirm`
- `PATCH /runs/:id/overrides`
- `POST /runs/:id/stages/:key/artifact` for previewed text/data edits
- `POST /runs/:id/stages/:key/approve` for approval or routed rejection
- `POST /runs/:id/stages/:key/input` for a parked `human.input` stage
- `POST /runs/:id/resume` for `PAUSED_BUDGET` or `FAILED`
- `POST /runs/:id/cancel`

Previewed mutations repeat the exact proposed payload with the returned signed
token. Tokens are bound to the run revision, action, payload digest, expiry, and
invalidation fingerprint; a competing mutation makes an older preview fail
closed. Approval and human-input waits do not expire. The hourly reminder sweep
records durable 24h/48h reminder events without changing run state.

## What's implemented

- `packages/shared`: every type from the design spec's Appendix A as Zod schemas, with unit
  tests covering the fiddly parsers (`ConfigLayer` nullish semantics, `Ref` discrimination,
  the restricted `JsonSchema` dialect, a `StageDef` round-trip).
- `apps/api`: full Drizzle schema for all 13 tables in §3, all 14 Nest modules from §1.3,
  `StorageAdapter` (MinIO via `@aws-sdk/client-s3`, `forcePathStyle: true`), a first-class
  `FakeProviderAdapter` with injectable failure modes plus an `OpenRouterAdapter`, the
  `text.generate` capability, Inngest orchestration (`run.orchestrate` → `stage.execute`) via
  the DI factory pattern, artifact finalization with the born-stale/stale-before-insert
  ordering the partial unique index requires, and the phase-1 API surface (channels,
  blueprints, templates, runs, capabilities, SSE run events).
- `apps/web`: channels list/create, a drag/drop visual Blueprint canvas (Phase 9.5) for
  authoring the stage graph, the capability-resolved editor and template library with a
  script-check tester and dry-run (Phase 9), channel Character management, instantiate →
  start a run → watch its state and stage executions update live via SSE, and the browser
  timeline editor for assembly. Built with Tailwind CSS v4 and shadcn/ui, with light/dark
  mode (`docs/design-system.md`).
- Phase 7 (`iterate`) sequential per-item loops with `prevItem` carry and per-item retry;
  Phase 8 channel Characters with reference upload/promotion and immutable run snapshots.
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

**Not yet verified:** a real run against OpenRouter or other funded media providers.

**Phase 4 restart acceptance:** with Docker Postgres/MinIO/Inngest running and migrations applied,
run `pnpm --filter @reelcraft/api acceptance:phase4-restart`. It compiles the API, starts a slow fake-provider run,
and stops/restarts the API process. It allows for Inngest's durable exponential callback retry
window, then verifies completion without a second provider submission. This is intentionally
local-only; CI covers deterministic HTTP action and race tests with Postgres alone.

## Known gotchas (see design spec for full context)

- **`blueprint` ↔ `blueprint_version` FK cycle** (§3.4): `blueprint.current_version_id` has no
  FK in the initial migration; `drizzle/0001_blueprint_current_version_fk.sql` adds it as a
  documented follow-up.
- **`artifact_active_uq`** (§3.9): a partial unique index that cannot be `DEFERRABLE`. Every
  artifact-superseding write must mark the old row stale _before_ inserting the new one, in one
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
- **Inngest client-ID rename cleanup:** changing the SDK client ID registers a new app but does not
  rename or delete the old app or its unfinished runs. After a rename, use the supported Inngest
  management surface for the deployed version:
  1. Stop sending events to the old client ID, then cancel unfinished old-app runs through an
     official Inngest API, CLI, MCP integration, or management UI.
  2. Archive the obsolete app in the Inngest management UI when that control is available. Keep its
     completed run history unless there is an explicit retention reason to remove it.
  3. Resync the current API endpoint, confirm the `reelcraft` app and functions are registered, and
     start a new test run. Verify that only `reelcraft` receives new events and that no obsolete
     client-ID function keeps retrying callbacks.

  The locally installed `inngest-cli` package is currently **1.44.0**. Its self-hosted server UI does
  not expose the cloud app-archive control or a supported app-archive endpoint. If the official
  API/CLI/MCP available for that installation also cannot archive the old app or cancel its runs,
  leave the persisted history intact and upgrade to a version with the required management support
  before completing the cleanup. **Never edit Inngest's private PostgreSQL tables and never reset
  either the Inngest or Reelcraft database to remove an old registration.** Those shortcuts can
  corrupt durable run state or delete unrelated history.

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
- **`@UsePipes()` at the method level applies to _every_ parameter, not just `@Body()`.**
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
- **`dotenv/config`'s bare import reads `.env` from `process.cwd()`, which pnpm sets to the
  package directory under `--filter`** — `pnpm db:migrate` (root) silently found no
  `DATABASE_URL` because it looked for `apps/api/.env`, not the repo-root `.env` the fresh-clone
  setup above actually creates. Fixed via `src/common/load-dotenv.ts`, which walks up to the
  `pnpm-workspace.yaml`-marked repo root instead of trusting cwd; both `migrate.ts` and
  `drizzle.config.ts` use it now.
- **`apps/api` test harness (`vitest.config.ts` unit / `vitest.e2e.config.ts` e2e)** needs
  `unplugin-swc` with `module: { type: 'es6' }` — not `'commonjs'`, even though the app itself
  builds to CommonJS. Vitest runs every file through Vite's own ESM module graph regardless of
  the app's `tsc`/`nest build` output target, and vitest's own package is ESM-only.
- **e2e tests isolate via a fresh Postgres _database_ per suite, not a schema.** A schema-per-
  suite approach (`search_path`) was tried first and silently produced empty tables:
  `drizzle-kit generate` hardcodes every FK's `REFERENCES` clause to `"public".<table>`
  (verified — all 25 FKs in `drizzle/0000_daffy_vision.sql`), so a table created in a non-public
  schema still has its foreign keys point at `public`'s tables regardless of `search_path`. See
  `test/support/test-db.ts`.
- **`typescript-eslint`'s `projectService` can't parse standalone build-tool config files**
  (`drizzle.config.ts`, `vitest.config.ts`, `vitest.e2e.config.ts`, and pre-existing
  `apps/web/vite.config.ts` / `packages/shared/vitest.config.ts`) — they aren't included by any
  app's `tsconfig.json`, so `pnpm lint` fails to parse them (confirmed pre-existing on `main`,
  not introduced by this change). `apps/api/test/**` is fixed via a sibling `test/tsconfig.json`
  (TS's project service auto-discovers the _nearest_ `tsconfig.json` by name); the remaining
  root-level `*.config.ts` files need an `allowDefaultProject` glob in `eslint.config.mjs`,
  which is protected by a `config-protection` hook this session couldn't get past — needs a
  maintainer to add it (or temporarily disable the hook).
- **Never wrap a `@reelcraft/shared` zod schema in a freshly-imported `z.record(...)`/`z.union(...)`
  inside `apps/api` test code.** Under Vite/vitest, `@reelcraft/shared`'s compiled `dist/` (its
  own `require('zod')`) and a plain `import { z } from 'zod'` in `apps/api` source end up as
  distinct module instances — `sharedSchema instanceof (apps/api's) z.ZodType` is `false` even
  though `sharedSchema.constructor.name === 'ZodObject'`. `z.record(keySchema, valueSchema)`
  relies on an internal `instanceof` check to tell its two-argument form apart from its
  one-argument form; when it silently fails, `z.record` falls back to the one-argument
  interpretation, so `z.record(z.string(), ConfigLayer)` quietly becomes "every value must be a
  string" instead of "every value must satisfy `ConfigLayer`" — a confusing `"expected string,
received object"` error with no hint of a module-identity problem underneath. Call `.parse()`
  directly on the shared schema instead (see `ConfigResolverService`'s `parseConfigLayerMap`);
  it never does a cross-module `instanceof` check.

## Follow-ups not done in this pass

- `pnpm --filter @reelcraft/api test:e2e` needs a live Postgres and isn't wired into CI yet
  (tracked in `docs/build-progress.md`) — run it locally against `docker compose up`.
- `eslint.config.mjs`'s shared-package import-boundary rule is scoped slightly too broadly
  (applies repo-wide rather than only under `packages/shared/**`) — harmless in practice since
  no import specifier in this codebase literally contains `apps/`, but worth tightening. See
  also the `allowDefaultProject` gap noted above — both need the same protected-config change.
