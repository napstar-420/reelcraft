# ADR-0007: The user guide is a separate Docusaurus project on GitHub Pages

**Date**: 2026-10-03 (recorded; decided while building the install guide, PR #52, Oct 2026)
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

The only user instructions were the README's "Run with Docker" section, which mixed user steps with
developer internals, and the short Docker Hub page. Non-developers need a step-by-step guide for Windows, macOS
and Linux. The owner also wants the name `website` for a future Reelcraft homepage.

## Decision

- **The guide is `apps/docs`**, a Docusaurus 3 project (docs only, `routeBasePath: '/'`), published to
  `https://napstar-420.github.io/reelcraft/docs/` by `.github/workflows/docs.yml`. PRs build it (broken links
  and anchors fail the build); pushes to `main` deploy it. The Pages root holds a small redirect to `/docs/`
  until a homepage (`apps/website`) exists; that build will replace the redirect in the same workflow.
- **It is outside the pnpm workspace** (`!apps/docs` in `pnpm-workspace.yaml`): own `package.json` and lockfile,
  installed with `pnpm install --ignore-workspace`. It is also in `.dockerignore` and ESLint's ignores, so the
  image, the root lockfile and the main CI job never install Docusaurus.
- **Scope**: self-hosting only (install, run, provider keys, BrowserOS Neo, Connect Codex, update, back up and
  uninstall, troubleshooting). A guide to using Reelcraft (making a first video) is left for later: the owner
  will write a dedicated one.
- **The app links to the guide** through `apps/web/src/lib/docs-url.ts`: a Help item in the sidebar, Setup guide
  links on the Neo and Codex cards, and a step-by-step link in the update dialog's new-image steps. Those page
  slugs are therefore a contract: `browseros-neo`, `codex`, and `updating#update-to-a-new-image`.
- **README, the Docker Hub page and release notes link to the guide.** The README keeps developer material.

## Alternatives Considered

### Alternative 1: Keep everything in the README

- **Why not**: too long, and written for developers.

### Alternative 2: Put the docs in the existing `docs/` folder

- **Why not**: `docs/` holds internal specs and phase plans. The owner chose `apps/docs` and left `docs/` alone.

### Alternative 3: Serve the guide at the Pages root

- **Why not**: moving it later, when the homepage arrives, would break links. `/reelcraft/docs/` reserves the root.

## Consequences

### Positive

- Users get a readable guide with screenshots, dark mode and search-engine-friendly pages. The app can link to it.

### Negative

- The guide must be updated whenever setup, Settings or update behaviour changes, using the UI's exact labels.
  `CLAUDE.md` has this rule.
- GitHub Pages must be enabled once (Settings → Pages → Source: GitHub Actions), or the deploy job fails.

### Risks

- Docker Desktop screenshots are missing: the Docker Desktop steps are text only (issue #54 lists them).
- The in-app links point at a site that doesn't exist until Pages is enabled and the Docs workflow has run.
