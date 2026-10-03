# Self-hosted Reelcraft: how it works

Reelcraft ships as one Docker image for people who aren't developers: they install Docker Desktop, run the
image, and use the app at `http://localhost:8080`. This is the map for anyone (human or agent) changing that
side of the project. The reasons behind each choice are in [`docs/adr/`](adr/README.md). The user-facing
guide is [`apps/docs`](../apps/docs/README.md), published at
<https://napstar-420.github.io/reelcraft/docs/>.

## What was built, in order

| Phase | What                                                                            | PR  |
| ----- | ------------------------------------------------------------------------------- | --- |
| 1     | The all-in-one image (ADR-0001, ADR-0002)                                       | #41 |
| 2     | Release pipeline: release-please, multi-arch images, signed bundles (ADR-0003)  | #42 |
| 3     | In-app updater (ADR-0004)                                                       | #48 |
| 4     | Settings page: provider keys, BrowserOS Neo, Connect Codex (ADR-0005, ADR-0006) | #50 |
| 5     | User guide on GitHub Pages (ADR-0007)                                           | #52 |

Each phase was one PR, stacked on the last. Releases so far: 0.1.0, 0.1.1, 0.2.0 (the first with the updater);
the release-please PR for 0.3.0 (Settings and the guide's in-app links) is #51.

## Where things are

| Path                                                          | What                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docker/app/Dockerfile`, `rootfs/`                            | The image. s6 services in `rootfs/etc/s6-overlay/s6-rc.d/`, scripts in `.../scripts/`    |
| `docker/app/RUNTIME_VERSION`                                  | The image's runtime number (see rules below)                                             |
| `docker/app/release-signing.pub`                              | Public key the updater verifies releases with                                            |
| `docker/app/rootfs/usr/local/lib/reelcraft/updater/`          | The in-app updater: agent (root, Unix socket), releases, signing, state, select-app      |
| `docker/app/smoke-test.sh`, `update-test.sh`                  | Boot-and-run test, and the end-to-end update/rollback test (both run in CI)              |
| `docker/app/DOCKERHUB.md`                                     | The Docker Hub page, pushed by the release workflow                                      |
| `scripts/release/`                                            | Manifest build, signing and key generation (`pnpm test:release`)                         |
| `.github/workflows/`                                          | `ci.yml`, `release.yml`, `runtime-version.yml`, `docs.yml`                               |
| `apps/api/src/update/`                                        | Relays the UI's update requests to the agent. No update logic lives here                 |
| `apps/api/src/settings/`                                      | Encrypted settings store, `/settings` routes, `/codex` routes, provider key tester       |
| `apps/api/src/provider/key-provider.ts`                       | `KEY_PROVIDER` → `SettingsKeyProvider` (environment, then saved)                         |
| `apps/api/src/provider/codex/`                                | `codex-login.service.ts`, `codex-device-page.ts` (Neo scripts), `codex-neo-registrar.ts` |
| `apps/web/src/pages/SettingsPage.tsx`, `components/settings/` | Settings UI. `settings.logic.ts` holds the tested pure helpers                           |
| `apps/web/src/components/update/`                             | Update indicator, dialog and `use-update-status.ts`                                      |
| `apps/web/src/lib/docs-url.ts`                                | Links from the app into the user guide                                                   |
| `apps/docs/`                                                  | The user guide (Docusaurus, outside the pnpm workspace)                                  |

## How it runs

- **First boot** (`init-data`): creates the folders in the `/data` volume, generates `/data/secrets.env`
  (database and storage passwords, Inngest keys, `PREVIEW_TOKEN_SECRET`, Deepgram callback secret), and
  initializes Postgres 16 with two databases, `reelcraft` and `inngest`. Keep `secrets.env`: it unlocks the data,
  including keys saved in Settings.
- **Services and what they wait for**: `init-data` first; then `postgres` and `minio` (both after `init-data`);
  `update-reconcile` (undoes an update a restart interrupted; after `postgres`); `migrate` (after `postgres` and
  `update-reconcile`); `inngest` (after `postgres`); `update-agent` (after `update-reconcile`); and `api` last
  (after `inngest`, `migrate` and `minio`). The API serves the web app and `/storage` (browser media goes
  through the API; only port 8080 is exposed).
- **Which app version runs** is chosen at each `api`/`migrate` start by `select-app.mjs`: trial update, then
  installed update, then the bundle built into the image.
- **A release**: merge the release-please PR → `release.yml` builds `amd64` and `arm64`, smoke-tests them,
  pushes images, builds per-architecture app bundles and a signed manifest, and publishes the release.
  Installed apps see it within 6 hours (or "Check now") and update themselves unless the manifest's `runtime`
  is newer than the image's.
- **Keys**: adapters ask `KEY_PROVIDER` on every call. Settings writes go through `SettingsService`, which
  encrypts secrets and clears dependent caches (OpenRouter models, the Neo connection, Codex readiness).
- **Connect Codex**: `codex login --device-auth` → parse link and code → Neo opens the page and types the code
  → the user approves in Neo → `codex mcp add` registers Neo. If Neo can't help, the page shows the link and code.

## Rules to follow when changing this

1. **Bump `docker/app/RUNTIME_VERSION`** in any change to `docker/app/Dockerfile`, `docker/app/rootfs/` (this
   includes the updater) or the `@remotion/renderer` version. CI enforces it; the `runtime-unchanged` label is
   for changes that can't affect the running container. If unsure, bump it. Web and API-only changes ship as
   in-app updates and need no bump.
2. **Never read provider keys from `process.env`** at the point of use: go through `KEY_PROVIDER`. Read the Neo
   address with `SettingsService.browserOsUrl()`, not `EngineConfig`. Never put provider keys in source,
   fixtures or commits.
3. **Never edit versions or `CHANGELOG.md` by hand.** The squash-merged PR title decides the bump: `feat` →
   minor; `fix`, `perf`, `revert` → patch; breaking (`!`) → minor below 1.0; `chore`, `docs`, `ci`, `test`,
   `refactor`, `style`, `build` don't bump and ship with the next release. There is no `develop` branch: leave the
   release PR open to batch changes.
4. **The release signing private key never goes through an agent session, a commit or a log.** It lives only in
   the `RELEASE_SIGNING_KEY` repository secret; `scripts/release/keygen.mjs` prints it once to the person running it.
5. **The updater stays in the image**, never in the app bundle (a downloaded update must not be able to change how
   updates are verified). The API only relays.
6. **Update the user guide (`apps/docs`)** when setup, Settings or update behaviour changes, with the UI's exact
   labels, and keep the page slugs the app links to stable (`browseros-neo`, `codex`,
   `updating#update-to-a-new-image`).
7. A new table that references channel, blueprint or run must go into `ChannelService.delete()`'s cascade
   (the existing rule in `CLAUDE.md`). `app_setting` has no such reference and isn't in it.

## Verifying a change

- Everyday checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:release`, and
  `pnpm test:e2e` against Postgres (`TEST_DATABASE_URL`). Build the shared package first
  (`pnpm --filter @reelcraft/shared build`) when a shared export seems missing.
- Image changes: build with
  `docker build -f docker/app/Dockerfile --build-arg REELCRAFT_VERSION=dev -t reelcraft:dev .`, then run
  `docker/app/smoke-test.sh reelcraft:dev` and `docker/app/update-test.sh reelcraft:dev`. The Dockerfile takes
  `NODE_IMAGE`, `GO_IMAGE` and `RUNTIME_IMAGE` build args for restricted networks.
- User guide: `cd apps/docs && pnpm install --ignore-workspace && pnpm build` (fails on broken links).
- Backup and restore of `/data`: the documented `tar` commands were tested against the built image: a restored
  volume boots healthy with saved keys and the Neo address intact.

## Lessons and gotchas

- **Nest dependency injection**: a constructor parameter typed as `Pick<SomeService, …>` is erased to `Object`,
  so Nest can't inject it. Use an explicit `@Inject(SomeService)`, or a factory provider when the constructor
  has optional parameters (see `provider.module.ts`).
- **`exactOptionalPropertyTypes`** is on: optional cache fields must be typed `… | undefined` to be reset.
- **MDX (the user guide)** rejects `<https://…>` autolinks. Use `[text](url)`.
- **Codex CLI facts** (codex-cli 0.159.3): `login status` exits 0 only when logged in; `mcp add <name> --url
<url>`, `mcp list --json` and `mcp remove` exist; `--profile reelcraft` works without a profile entry; the
  device-auth output reads "Follow these steps to sign in with ChatGPT using device code authorization" and
  "Enter this one-time code", with the page at `https://auth.openai.com/codex/device`.
- **`CODEX_BROWSER_OS_URL` is set by the image**, so a fresh install's Settings shows the Neo address as "From the
  container environment". That's expected, not a user override.
- **A Linux host without Docker Desktop** needs `--add-host=host.docker.internal:host-gateway` to reach Neo.
- **Deepgram** needs to reach the instance (`PUBLIC_API_BASE_URL`), so it doesn't work on a desktop install.
- **Cloud sandboxes**: outbound traffic goes through a proxy that blocks some hosts (for example
  `auth.openai.com`), so real Codex sign-in and BrowserOS docs couldn't be checked from there. Docker needs
  `dockerd` started by hand.

## Open items (as of 2026-10-03)

- **Untested on a real setup**: Connect Codex's Neo automation against OpenAI's device page (issue #53).
- **Docker Desktop screenshots** for the guide (issue #54), and BrowserOS Neo's real menu names for its MCP server.
- **GitHub Pages** must be enabled once (Settings → Pages → Source: GitHub Actions) before the guide is live.
- **0.3.0** is waiting on its release-please PR (#51). It will be the first real in-app update from 0.2.0.
- No login (ADR-0002): don't encourage exposing the port. Authentication is the prerequisite for any hosted version.
