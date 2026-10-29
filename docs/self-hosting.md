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

| Path                                                          | What                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docker/app/Dockerfile`, `rootfs/`                            | The image. s6 services in `rootfs/etc/s6-overlay/s6-rc.d/`, scripts in `.../scripts/`         |
| `docker/app/RUNTIME_VERSION`                                  | The image's runtime number (see rules below)                                                  |
| `docker/app/release-signing.pub`                              | Public key the updater verifies releases with                                                 |
| `docker/app/rootfs/usr/local/lib/reelcraft/updater/`          | The in-app updater: agent (root, Unix socket), releases, signing, state, select-app           |
| `docker/app/smoke-test.sh`, `update-test.sh`                  | Boot-and-run test, and the end-to-end update/rollback test (both run in CI)                   |
| `docker/app/DOCKERHUB.md`                                     | The Docker Hub page, pushed by the release workflow                                           |
| `scripts/release/`                                            | Manifest build, signing and key generation (`pnpm test:release`)                              |
| `.github/workflows/`                                          | `ci.yml`, `release.yml`, `runtime-version.yml`, `docs.yml`                                    |
| `apps/api/src/update/`                                        | Relays the UI's update requests to the agent. No update logic lives here                      |
| `apps/api/src/settings/`                                      | Encrypted settings store, `/settings` routes, `/codex` and `/claude` routes, key tester       |
| `apps/api/src/provider/key-provider.ts`                       | `KEY_PROVIDER` → `SettingsKeyProvider` (environment, then saved)                              |
| `apps/api/src/provider/codex/`                                | `codex-login.service.ts`, `codex-device-page.ts` (Neo scripts), `codex-neo-registrar.ts`      |
| `apps/api/src/provider/claude/`                               | `claude-login.service.ts`, `claude-login-page.ts` (sign-in addresses), the Claude adapter     |
| `apps/api/src/provider/cli-job/`                              | The durable job adapter and runner shared by Codex and Claude                                 |
| `services/qwen-tts/`                                          | The local Qwen3-TTS service (Python). Its source is copied into the image; see below          |
| `apps/api/src/provider/qwen/`                                 | The `qwen-tts` provider, and `qwen-runtime.service.ts`, which installs and runs the service   |
| `apps/api/src/provider/voicestudio/`                          | The `voicestudio` provider: VoiceStudio, a voice app the user runs, reached by URL (ADR 0018) |
| `apps/web/src/pages/SettingsPage.tsx`, `components/settings/` | Settings UI. `settings.logic.ts` holds the tested pure helpers                                |
| `apps/web/src/components/update/`                             | Update indicator, dialog and `use-update-status.ts`                                           |
| `apps/web/src/lib/docs-url.ts`                                | Links from the app into the user guide                                                        |
| `apps/docs/`                                                  | The user guide (Docusaurus, outside the pnpm workspace)                                       |

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
- **Connect Claude** (ADR-0016): `claude auth login --claudeai` → parse the authorize link → Neo opens it → the
  user signs in and approves → Reelcraft reads `code#state` from the callback page's address in Neo and types it
  into the CLI. If Neo can't help, the page shows the link and a box to paste the code. The login lives in
  `/data/claude` (`CLAUDE_CONFIG_DIR`). Claude jobs get Neo per job (`--mcp-config`), so nothing is registered.
- **Local Qwen3-TTS** (ADR 0013): the image has `uv` and the service's source (`/opt/reelcraft/qwen-tts`, outside the
  app bundle) but no Python packages or models. When the user chooses **Set up**, the API (`QwenTtsRuntime`)
  runs `uv venv` and `uv pip install --torch-backend auto … -c constraints.txt` into `/data/qwen-tts` (`UV_*`
  point the cache and managed Python there too), starts the service as a child process the first time speech
  is needed, and stops it after 10 idle minutes. The service exits when its stdin closes, so it never outlives
  the API. `/data/qwen-tts` is left out of the documented backups. A saved service address (or `QWEN_TTS_URL`)
  turns all of this off: Reelcraft then only talks to a service the user runs.
- **VoiceStudio** (ADR 0018): a voice app the user installs and runs; the image has nothing of it. The API
  reaches it at the saved address, else `VOICESTUDIO_URL`, else `http://host.docker.internal:3900` inside the
  container (`/.dockerenv`) and `http://127.0.0.1:3900` outside, sending `VOICESTUDIO_API_KEY` (or the key saved
  in Settings) as a bearer token. A Linux host without Docker Desktop needs
  `--add-host=host.docker.internal:host-gateway` for the default to work. Voices cloned from the library live
  in VoiceStudio, not in Reelcraft's backups.

## Rules to follow when changing this

1. **Bump `docker/app/RUNTIME_VERSION`** in any change to `docker/app/Dockerfile`, `docker/app/rootfs/` (this
   includes the updater), the baked Qwen3-TTS service files (`services/qwen-tts/src/`, `pyproject.toml`,
   `constraints.txt`) or the `@remotion/renderer` version. CI enforces it; the `runtime-unchanged` label is
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
   labels, and keep the page slugs the app links to stable (`browseros-neo`, `codex`, `claude-code`,
   `updating#update-to-a-new-image`).
7. A new table that references channel, blueprint or run must go into `ChannelService.delete()`'s cascade
   (the existing rule in `CLAUDE.md`). `app_setting` has no such reference and isn't in it.
8. **Keep the Qwen3-TTS service out of the app bundle and the packages out of the image.** The source lives at
   `/opt/reelcraft/qwen-tts`, never under `/opt/reelcraft/app` (in-app updates replace that). Python packages and
   models go to `/data/qwen-tts` on request. Keep `UV_VERSION` in the Dockerfile and in
   `.github/workflows/qwen-tts.yml` the same (`--torch-backend` differs between uv versions), and regenerate
   `services/qwen-tts/constraints.txt` (see its README) when its dependencies change.

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
  volume boots healthy with saved keys and the Neo address intact. The backup command leaves out
  `/data/qwen-tts` (`--exclude=./qwen-tts`).
- Qwen3-TTS in the image: `smoke-test.sh` checks `uv` runs as root and as `reelcraft`, that `/data/qwen-tts` is
  writable and that `GET /api/qwen-tts/setup` reports `managed` and `not-installed`. A full install in the
  container (CPU on Docker Desktop for Mac) is a manual check: `POST /api/qwen-tts/setup/install`, poll the same
  route until `stopped`, then `POST …/start`.

## Lessons and gotchas

- **Nest dependency injection**: a constructor parameter typed as `Pick<SomeService, …>` is erased to `Object`,
  so Nest can't inject it. Use an explicit `@Inject(SomeService)`, or a factory provider when the constructor
  has optional parameters (see `provider.module.ts`).
- **`exactOptionalPropertyTypes`** is on: optional cache fields must be typed `… | undefined` to be reset.
- **MDX (the user guide)** rejects `<https://…>` autolinks. Use `[text](url)`.
- **Codex CLI facts** (verified with codex-cli 0.159.3; `login status` exiting 0 when logged in and `mcp add <name> --url
<url>`, `mcp list --json` and `mcp remove` re-checked on 0.160.0, the image's version): `login status` exits 0 only when logged in;
  `--profile reelcraft` works without a profile entry; the
  device-auth output reads "Follow these steps to sign in with ChatGPT using device code authorization" and
  "Enter this one-time code", with the page at `https://auth.openai.com/codex/device`.
- **Claude Code CLI facts** (verified with 2.1.286, the image's version): see [`claude-provider.md`](claude-provider.md).
  `claude auth login` works without a TTY (link on stdout, code on stdin); `claude auth status --json` exits 1 when
  signed out but still prints JSON; `--resume <id>` finds a session from any working directory.
- **A file named `claude.md` is a `CLAUDE.md`** on macOS's case-insensitive file system, so Claude Code loads it
  as instructions. That is why the user guide's page is `claude-code.md` (slug `claude-code`).
- **`CODEX_BROWSER_OS_URL` is set by the image**, so a fresh install's Settings shows the Neo address as "From the
  container environment". That's expected, not a user override.
- **A Linux host without Docker Desktop** needs `--add-host=host.docker.internal:host-gateway` to reach Neo.
- **Browser notifications** (Web Push, ADR-0011) work only on `localhost` or `https`: a service worker can't
  register on a plain-`http` LAN address, so there the bell and pop-ups work but system notifications don't. The
  container also needs outbound internet to reach the browser vendor's push service. The VAPID key is made on
  first use and saved in Settings (`push.vapidPrivateKey`, sealed with `secrets.env` like provider keys); if
  `secrets.env` is lost it is replaced and each browser resubscribes on its next page load.
- **Deepgram** transcription uploads the audio bytes with the request (`DeepgramAdapter.transcribeStored`), so it
  works on a desktop install. Don't send Deepgram a presigned URL: storage URLs point at `127.0.0.1`/`localhost`
  and Deepgram rejects them as not publicly routable.
- **Cloud sandboxes**: outbound traffic goes through a proxy that blocks some hosts (for example
  `auth.openai.com`), so real Codex sign-in and BrowserOS docs couldn't be checked from there. Docker needs
  `dockerd` started by hand.

## Open items (as of 2026-10-03)

- **Untested on a real setup**: Connect Codex's Neo automation against OpenAI's device page (issue #53).
- **Docker Desktop screenshots** for the guide (issue #54), and BrowserOS Neo's real menu names for its MCP server.
- **GitHub Pages** must be enabled once (Settings → Pages → Source: GitHub Actions) before the guide is live.
- **0.3.0** is waiting on its release-please PR (#51). It will be the first real in-app update from 0.2.0.
- No login (ADR-0002): don't encourage exposing the port. Authentication is the prerequisite for any hosted version.
