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

## Code Conventions

- Use TypeScript, async/await, named exports, and kebab-case filenames. React components are PascalCase.
- Validate external DTOs with shared Zod schemas via `ZodValidationPipe`; change shared DTOs when an API contract changes.
- Keep Nest domain boundaries intact. `DbModule` is deliberately not global; import it explicitly where needed. `CapabilityModule` must not import `db`, `run`, or `blueprint` modules.
- Use `toUsd`/`fromUsd` in `apps/api/src/common/money.ts` for database money fields; do not coerce numeric columns with `Number()`.
- Artifact replacement must stale the old artifact before inserting the new one, inside one transaction.
- Run state changes flow through the durable wakeup/outbox and Inngest pipeline; do not make the UI the execution driver.

## Testing and CI

- Place unit tests beside source as `*.test.ts`; place API E2E tests in `apps/api/test/e2e/*.e2e.test.ts`.
- API unit tests use Vitest with SWC to preserve Nest decorator metadata. E2E tests require `TEST_DATABASE_URL`/Postgres.
- CI runs shared build, root/API typechecks, lint, formatting, shared/API unit tests, then API E2E tests.
- FFmpeg/ffprobe and Chrome/Chromium are required only for local media/render acceptance scripts, not normal CI.

## Git

- Use conventional commits such as `feat(api): ...`, `fix(web): ...`, `test(media): ...`, and `docs: ...`.
- Use `codex/` for newly created Codex branches unless a task specifies another branch name. Recent merged PRs use squash-style conventional commit subjects with PR numbers.
