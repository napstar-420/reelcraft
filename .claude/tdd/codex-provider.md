# Codex provider TDD evidence

## RED checkpoint

- Commit: `36d81e3 test: define Codex provider behavior`
- API: three suites failed to load because `codex-command`, `codex-app-server.client`, and
  `codex-provider.adapter` did not exist.
- Web: the editor logic suite failed to load because `model-pin-editor.logic` did not exist.

## GREEN evidence

- Targeted API: 3 files, 15 tests passed.
- Targeted web: 1 file, 3 tests passed.
- Full workspace unit suite: shared, API, and web passed.
- Root typecheck, lint, and format check passed (one pre-existing unused-import lint warning).
- API, web, and render-worker production builds passed.
- Live read-only `codex app-server model/list` returned five visible authenticated models with
  their default and supported efforts.
- The real `codex exec` acceptance remains intentionally opt-in and was not run automatically.

Coverage includes all six adapter methods, duplicate idempotent submission, structured output,
unsupported effort, cancellation, API-restart recovery, stale/lost processes, provider failure,
malformed and oversized output, raw config serialization, reserved invocation flags, model
pagination/filtering/cache expiry/auth failure, effort fallback, reserved-param hiding, and
non-Codex editor compatibility.
