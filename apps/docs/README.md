# Reelcraft docs

The user guide for self-hosting Reelcraft, built with [Docusaurus](https://docusaurus.io) and
published to <https://napstar-420.github.io/reelcraft/docs/> by `.github/workflows/docs.yml` on
every push to `main` that touches `apps/docs/`. Pull requests build it to catch broken links.

It is **not** part of the pnpm workspace (`!apps/docs` in `pnpm-workspace.yaml`), so the app, the
image and the root lockfile never install Docusaurus. Install and run it on its own:

```bash
cd apps/docs
pnpm install --ignore-workspace
pnpm start        # live preview at http://localhost:3000/reelcraft/docs/
pnpm build        # static site in build/; fails on broken links
pnpm typecheck
```

Pages are Markdown/MDX in `docs/`; the sidebar is `sidebars.ts`. Use the exact labels the app
shows (Settings card titles, button names). Update the guide whenever setup, Settings or update
behaviour changes. The web app links to pages by slug through `apps/web/src/lib/docs-url.ts`, so
keep those slugs (`browseros-neo`, `codex`, `updating#update-to-a-new-image`) stable.

## Screenshots

`static/img/app/` holds screenshots of Reelcraft itself: light theme, 1280 px wide, no real keys.

Docker Desktop screenshots still to add, in `static/img/docker-desktop/`. Each page has a
`{/* Screenshot: … */}` comment where its image goes; replace the comment with
`![description](/img/docker-desktop/<file>)`.

| File                        | Page             | Shows                                                             |
| --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `search.png`                | Run Reelcraft    | Search results for `zohaibkhan97/reelcraft`, with the Run button  |
| `run-optional-settings.png` | Run Reelcraft    | The Run dialog's Optional settings filled in (name, port, volume) |
| `containers.png`            | Run Reelcraft    | The Containers list with reelcraft running and its 8080:8080 link |
| `images-pull.png`           | Update Reelcraft | Images, with the reelcraft image's ⋮ menu open on Pull            |
| `logs.png`                  | Troubleshooting  | The reelcraft container's Logs tab                                |
