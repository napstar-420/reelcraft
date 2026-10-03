# ADR-0002: Public images, no built-in login

**Date**: 2026-10-03 (recorded; decided before the image and release work, Oct 2026)
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Reelcraft is a single-user tool that runs on the user's own computer. It holds provider API keys and can
spend money with them. Users find it through Docker Desktop's image search, which only lists public images.

## Decision

Images are public, on **Docker Hub** (found by Docker Desktop's search) and on **GHCR**
(`ghcr.io/napstar-420/reelcraft`). Reelcraft has **no authentication**: anyone who can reach port 8080
can use the app and the saved keys. The docs say so plainly (README "Security", the user guide
introduction, and the Docker Hub page): run it on your own computer or a trusted network, never on the internet.

Docker Hub publishing is optional in `release.yml`: it happens only when the `DOCKERHUB_IMAGE`
repository variable and the `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets exist. GHCR always publishes.

## Alternatives Considered

### Alternative 1: Add a login (password or SSO)

- **Pros**: safe to expose on a network.
- **Cons**: first-run setup, password reset and session handling for a tool that runs on one computer; it
  would work against the one-click install.
- **Why not**: not needed for the target use. Revisit before anyone is told to host Reelcraft remotely.

### Alternative 2: Private images

- **Pros**: not world-readable.
- **Cons**: Docker Desktop search can't find them, and users would need registry credentials.
- **Why not**: defeats "search and click Run".

## Consequences

### Positive

- Zero setup for the user. No account system to build or secure.

### Negative

- Exposing the port exposes the keys. This is documented, not enforced.
- Settings routes (`/api/settings`, `/api/codex`) are unauthenticated too. Key values are write-only through
  the API: only a masked hint comes back.

### Risks

- A user port-forwards 8080. Mitigation: the repeated warning in the docs. Any future "host it online" feature
  needs authentication first.
