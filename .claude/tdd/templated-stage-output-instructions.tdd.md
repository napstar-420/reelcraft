# Templated Stage Output Instructions — TDD Evidence

## Source and journeys

The source plan was supplied in the implementation request. It covers authors adding templated output guidance, the engine composing and auditing one prompt, and providers enforcing structured Data output without exposing owned request fields.

## Task report

| Guarantee                                                                                         | Test target                                                    | Type                   | Result |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------- | ------ |
| Text/Data instructions are optional and capped at 4,000 characters                                | `packages/shared/src/output.test.ts`                           | Unit                   | PASS   |
| Task and output instructions share interpolation scope and produce the exact conditional contract | `apps/api/src/common/prompt-template.test.ts`                  | Unit                   | PASS   |
| Invalid output-instruction references report `stages.<key>.output.instructions`                   | `apps/api/src/blueprint/blueprint-validator.test.ts`           | Unit                   | PASS   |
| One composed prompt is estimated, submitted, and persisted                                        | `apps/api/src/orchestration/stage-runner.service.test.ts`      | Integration-style unit | PASS   |
| OpenRouter protects owned fields, routes only to schema-capable endpoints, and parses Data JSON   | `apps/api/src/provider/openrouter/openrouter.adapter.test.ts`  | Unit                   | PASS   |
| Blueprint save and run start reject unsupported OpenRouter Data models                            | `apps/api/src/provider/structured-output-validation.test.ts`   | Unit                   | PASS   |
| Editor visibility and Text/Data transitions preserve or clear metadata correctly                  | `apps/web/src/components/canvas/stage-inspector.logic.test.ts` | Unit                   | PASS   |

## RED/GREEN evidence

- Blueprint validator: two new reference-validation cases failed before the validator change, then the focused shared/prompt/validator suite passed 79 tests.
- OpenRouter adapter: five new tests failed before implementation, then the provider suite passed 17 tests.
- Editor logic: tests first failed on the missing logic module and issue classifier, then the web suite passed 9 tests.
- Review regressions: capability detection, owned routing/stream fields, and prompt-boundary tests failed before hardening, then passed 18 focused tests.

## Final verification

- `pnpm typecheck` — PASS.
- `pnpm test` — PASS: shared 33, API 312, web 9.
- `pnpm test:e2e` — PASS: 184 tests, run outside the sandbox for local PostgreSQL access.
- `pnpm lint` — PASS with one pre-existing unrelated unused-import warning in `apps/api/test/e2e/media-output.e2e.test.ts`.
- `pnpm format:check` — PASS.
- API and web production builds — PASS; web reports the existing bundle-size warning.

No coverage script is defined in the workspace, so coverage percentage was not measured. No commits were created; commit approval remains the final workflow gate.
