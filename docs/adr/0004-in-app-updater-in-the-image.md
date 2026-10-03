# ADR-0004: The in-app updater lives in the image, and image and app bundle version separately

**Date**: 2026-10-03 (recorded; decided while building the updater, PR #48, Oct 2026)
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Users shouldn't have to pull a new image and recreate the container for every release. But most releases only
change the app (API, web, migrations), while some change the container itself (Postgres, Chromium, system
libraries). An update mechanism must also never leave a user with a broken app and a database that has
already been migrated.

## Decision

- **Two version numbers.** The _app bundle_ (`/opt/reelcraft/app` in the image) is what an in-app update
  replaces. The _runtime_ is the image around it, identified by the integer in `docker/app/RUNTIME_VERSION`
  (currently 3). A release's manifest carries the `runtime` it needs. If it is higher than the running
  image's, or the manifest's `minUpdaterVersion` is higher than the image's updater, the app shows
  **Version X.Y.Z available** with image-update steps instead of an install button (`needsNewImage`).
- **Bump `RUNTIME_VERSION` in any change to `docker/app/Dockerfile` or `docker/app/rootfs/`, or to the
  `@remotion/renderer` version.** The `runtime-version` CI workflow enforces it; the `runtime-unchanged` label
  overrides it for changes that can't affect the running container.
- **The updater is in the image**, not in the app bundle:
  `docker/app/rootfs/usr/local/lib/reelcraft/updater/` (plain Node `.mjs`, tests run by `pnpm test:release`). It
  runs as a root-owned s6 service, `update-agent`, on the Unix socket `/run/reelcraft/updater.sock` (root and the
  `reelcraft` group). `apps/api/src/update/` only relays the user's requests to it. Changes to the updater are
  runtime changes.
- **An update** (`updater.mjs`): list GitHub Releases, fetch the manifest and verify its Ed25519 signature
  against `/opt/reelcraft/release-signing.pub`; download this architecture's bundle and check its size and
  SHA-256; unpack into `/data/app/versions/X.Y.Z`; `pg_dump` the database to `/data/backups` (the last 3 are
  kept); record a **trial** in `/data/app/state.json`; restart only the `api` service.
- **Which bundle runs** is decided at start by `select-app.mjs`: a trial, then the active installed update,
  then the image's own bundle. An installed update is used only if it is newer than the image's bundle and needs
  no newer runtime, so pulling a newer image always wins over an old in-app update. The API's start script
  applies that bundle's migrations first.
- **Rollback.** The trial becomes active when the API reports healthy on the new version. If it doesn't within
  5 minutes, the agent stops the API, restores the backup and starts the previous version. A container restart
  mid-update is reconciled at boot by `update-reconcile`, before migrations.
- It checks for updates every 6 hours (and on "Check now"). `REELCRAFT_UPDATES=off` stops all requests to
  GitHub. Builds whose version isn't semver (such as `dev` or `ci-<sha>`) never take part in updates (`versions.mjs`).

## Alternatives Considered

### Alternative 1: Pull a new image for every release

- **Pros**: simplest, nothing to verify or roll back in the container.
- **Cons**: a multi-step manual job in Docker Desktop for each release. This is still the path when the runtime
  changes, and the only path before 0.2.0.
- **Why not**: too much work for non-developers on every release.

### Alternative 2: Put the updater in the app bundle

- **Pros**: it could update itself.
- **Cons**: a downloaded update could change how updates are verified.
- **Why not**: the verification code and public key must come from the image, which the user chose to pull.

## Consequences

### Positive

- Most updates are three clicks, signed, backed up and automatically rolled back.
- The root-owned agent keeps `/data/app` read-only to the app, which runs as an unprivileged user.

### Negative

- Two version numbers to reason about. Any change to what's in the image needs the `RUNTIME_VERSION` bump,
  or in-app updates would install onto an image that can't run them.
- Runs in progress are interrupted by the restart (the dialog warns first); their current step retries.
- Database migrations must work forward only on the trial path: rollback restores the pre-update backup, so data
  written during a failed trial is lost.

### Risks

- A bad `RUNTIME_VERSION` decision is the main way to break users. When unsure, bump it.
- Images before 0.2.0 have no updater; those users update by pulling the image once.
- `docker/app/update-test.sh` is the end-to-end check (fake GitHub API, throwaway signing key, a good and a
  broken update). CI runs it (and the smoke test) on every push; run it locally when touching the updater.
