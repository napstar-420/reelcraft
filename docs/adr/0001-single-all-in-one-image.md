# ADR-0001: One all-in-one image on a single volume

**Date**: 2026-10-03 (recorded; decided while building the self-hosted image, Oct 2026)
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Reelcraft's development stack is several processes: the API, Postgres, MinIO and Inngest, started by
`docker-compose.yml` from a repo clone. The people we want to reach are not developers. They install
Docker Desktop, search for an image, click **Run**, and don't clone anything or use a terminal.

## Decision

We ship one image (`docker/app/Dockerfile`) that runs everything under
[s6-overlay](https://github.com/just-containers/s6-overlay): the API (serving the built web app),
Postgres 16, MinIO and Inngest. It exposes only port 8080 and keeps all state in one volume mounted at
`/data`. Services are defined in `docker/app/rootfs/etc/s6-overlay/s6-rc.d/`.

## Alternatives Considered

### Alternative 1: Keep docker-compose, document it

- **Pros**: one process per container, the usual way to run a stack.
- **Cons**: needs a repo clone or a compose file, a terminal, and several containers to manage.
- **Why not**: Docker Desktop's **Run** button runs a single image. Compose is the developer path and stays
  in the repo for development.

## Consequences

### Positive

- Install is one image, one port, one volume. Backup is one volume (see the user guide).
- Secrets are generated on first boot into `/data/secrets.env` (`init-data`), so there is nothing to configure.

### Negative

- The image is large (Chromium, FFmpeg, Postgres, Codex): about 1 GB to download.
- Several services share one container, so a crashing service shows up as a container-level problem.
  `S6_BEHAVIOUR_IF_STAGE2_FAILS=2` stops the container when a oneshot such as `migrate` fails.
- MinIO now publishes source only. The Dockerfile compiles a pinned commit (AGPLv3, unmodified) and the
  image carries the `org.reelcraft.minio.source` label for compliance.
- Postgres is pinned to major 16. `init-data` refuses to start on a data folder from another major version.

### Risks

- A Postgres major upgrade needs a data migration step that doesn't exist yet. It would be an image
  (runtime) change, see ADR-0004.
