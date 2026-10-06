# Reelcraft Project Instructions

## Stack

- pnpm 9 workspace; Node.js 22+; TypeScript 5.7.
- `apps/api`: NestJS REST/SSE API, Drizzle with PostgreSQL, Inngest orchestration, MinIO-compatible storage.
- `apps/web`: React 18, Vite, React Router, TanStack Query, Tailwind v4/shadcn UI.
- `apps/render-worker` and `packages/timeline-composition`: Remotion rendering.
- `packages/shared`: Zod schemas, domain types, and API DTOs shared by API and web.

## Commands

```bash
pnpm dev                         # API :3000 and web :5173
pnpm typecheck                   # root TS project references
pnpm lint && pnpm format:check   # CI style checks
pnpm test                        # shared + API unit suites
pnpm test:e2e                    # API E2E suite; requires PostgreSQL
pnpm test:release                # release manifest signing tests
pnpm db:generate && pnpm db:migrate
pnpm --filter @reelcraft/api test -- path/to/file.test.ts
pnpm --filter @reelcraft/web typecheck
pnpm --filter @reelcraft/render-worker typecheck
```

For a fresh local stack: copy `.env.example` to `.env`, then run `docker compose up -d`, `pnpm install`, and `pnpm db:migrate`. Do not put provider keys in source, fixtures, or commits. The fake provider is the default for free deterministic development/tests.

## Structure

- `apps/api/src/<domain>/`: Nest modules, controllers, services, and focused unit tests.
- `apps/api/src/db/schema/`: Drizzle schema; generated SQL migrations live in `apps/api/drizzle/`.
- `apps/api/src/orchestration/`: durable Inngest functions and run-stage execution.
- `apps/api/test/e2e/`: HTTP/DB/integration tests and reusable harnesses.
- `apps/web/src/pages/`: routes; `components/`: UI and canvas components; `api/client.ts`: typed API boundary.
- `packages/shared/src/`: Zod source of truth. It must not import from `apps/*` or perform I/O.
- `packages/timeline-composition/`: shared Remotion preview/final-render composition.
- `docs/self-hosting.md` and `docs/adr/`: how the self-hosted image, releases, in-app updater, Settings and user guide fit together, the rules for changing them, and the decisions behind them. Read these before touching `docker/app/`, `.github/workflows/release.yml`, `apps/api/src/update|settings/` or the Codex connect flow.
- `apps/docs/`: the user guide (Docusaurus), published to GitHub Pages by `.github/workflows/docs.yml`. It is outside the pnpm workspace (`pnpm install --ignore-workspace` there). Update it whenever user-facing setup, Settings or update behaviour changes, using the UI's exact labels; keep page slugs stable, since `apps/web/src/lib/docs-url.ts` links to them.

## Code Conventions

- Use TypeScript, async/await, named exports, and kebab-case filenames. React components are PascalCase.
- `apps/web` imports only types from `@reelcraft/shared`: it is built as CommonJS, so Vite can't import runtime values (schemas, functions) from it. Put web-only helpers in `apps/web/src/lib/`.
- Validate external DTOs with shared Zod schemas via `ZodValidationPipe`; change shared DTOs when an API contract changes.
- Keep Nest domain boundaries intact. `DbModule` is deliberately not global; import it explicitly where needed. `CapabilityModule` must not import `db`, `run`, or `blueprint` modules.
- Provider keys resolve through `KEY_PROVIDER` (`SettingsKeyProvider`: the environment first, then keys saved encrypted in Settings); never read provider keys from `process.env` at the point of use. Read the BrowserOS Neo address with `SettingsService.browserOsUrl()`, not `EngineConfig`.
- Use `toUsd`/`fromUsd` in `apps/api/src/common/money.ts` for database money fields; do not coerce numeric columns with `Number()`.
- Artifact replacement must stale the old artifact before inserting the new one, inside one transaction.
- Run state changes flow through the durable wakeup/outbox and Inngest pipeline; do not make the UI the execution driver.
- Any new table with a foreign key into the channel/blueprint/run graph (directly or transitively) must be added to the delete cascade: `deleteRunsCascade()` in `apps/api/src/run/run-cascade.ts` for anything under a run (shared by channel and blueprint delete), otherwise `ChannelService.delete()` in `apps/api/src/channel/channel.service.ts`, and to the e2e tests that assert the cascade (`channel-delete-cascade.e2e.test.ts`). Deleted rows' files go to `storage_orphan` (`queueStorageOrphans`) so the `blob.gc` sweep removes them. Check this whenever adding or modifying a Drizzle schema table/column that references `channel`, `blueprint`, or `run` — Postgres only catches a missed table if it has rows at delete time, so this can silently go stale without failing a single test.

## Claude Code plugins

- `.claude/settings.json` enables the ECC plugin (`ecc@ecc`, from `affaan-m/ECC`, pinned to a release tag) for its skills and agents. Its hooks are off for everyone via `ECC_HOOKS_ENABLED=false`; to use them, set `"env": { "ECC_HOOKS_ENABLED": "true" }` in your own `.claude/settings.local.json` (gitignored). Bump the pinned `ref` deliberately, after reading the release's hook changes.

## Testing and CI

- Place unit tests beside source as `*.test.ts`; place API E2E tests in `apps/api/test/e2e/*.e2e.test.ts`.
- API unit tests use Vitest with SWC to preserve Nest decorator metadata. E2E tests require `TEST_DATABASE_URL`/Postgres.
- CI runs shared build, root/API typechecks, lint, formatting, shared/API unit tests, then API E2E tests.
- FFmpeg/ffprobe and Chrome/Chromium are required only for local media/render acceptance scripts, not normal CI.

## Git

- Use conventional commits such as `feat(api): ...`, `fix(web): ...`, `test(media): ...`, and `docs: ...`.
- Use `codex/` for newly created Codex branches unless a task specifies another branch name. Recent merged PRs use squash-style conventional commit subjects with PR numbers.
- Versions and `CHANGELOG.md` are generated by release-please from those commit subjects; merging its release PR publishes the release (`.github/workflows/release.yml`). Don't edit versions or the changelog by hand.
- Bump `docker/app/RUNTIME_VERSION` in any change to `docker/app/Dockerfile` or `docker/app/rootfs/`, or to the `@remotion/renderer` version (CI enforces this; the `runtime-unchanged` label overrides it for changes that can't affect the running container).
- The in-app updater lives in the image (`docker/app/rootfs/usr/local/lib/reelcraft/updater/`, plain Node `.mjs` with `node:test` tests run by `pnpm test:release`), never in the app bundle; `apps/api/src/update/` only relays to it. Changes to it are runtime changes.
