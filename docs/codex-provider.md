# Codex CLI provider

The `codex` provider is a local, single-user `text.generate` adapter. The API process uses the
host user's existing Codex CLI login and configuration. Model discovery comes from the authenticated
`model/list` app-server protocol and is cached briefly; hidden models are excluded. Model and effort
are validated again when a blueprint is saved, when a run starts, and immediately before submission.

Each idempotency key maps to one private directory under `WORKSPACE_ROOT/codex-jobs`. The durable
status file and hashed directory name survive API restarts. A detached runner invokes `codex exec`
with argument arrays, never a shell, and owns the output path, schema, working directory, automatic
approval policy, model, effort, and ephemeral mode. Raw dotted params are TOML-serialized `-c`
overrides, except those invocation-owned keys. The short-lived runner request is mode `0600` and is
deleted as soon as the runner reads it. Durable metadata redacts secret-like params and records only
aggregate JSONL event types, never BrowserOS tool arguments or payloads.

Text outputs return the final message verbatim. Data stages pass their authored JSON Schema to Codex
and parse the final JSON before the engine's existing validation. Timeline stages use the
engine-owned timeline schema before existing canonicalization. All Codex estimates and settlements
are `$0`; token and event information is diagnostic only.

## Local acceptance

The real-provider smoke test is deliberately opt-in because it consumes authenticated Codex usage:

```bash
REELCRAFT_CODEX_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:codex
```

## Manual BrowserOS acceptance

Use only a disposable test site and account. Ensure the host-managed BrowserOS Neo MCP server and
profile are already running, then create a `text.generate` stage pinned to `codex` whose prompt names
one harmless, reversible mutation (for example, create and then identify a draft record). Run it
unattended and verify all of the following:

1. Codex used the selected model and reasoning effort and BrowserOS performed exactly the requested action.
2. The stage failed clearly if BrowserOS was disconnected or an interactive confirmation was required.
3. The durable job directory contains no raw BrowserOS payload, signed-in page data, detailed tool arguments, or unredacted credentials.
4. The ledger settled at `$0`, cancellation remained idempotent, and no fallback provider was called.
5. Delete the disposable account/site data after the check.

Browser-capable prompts can purchase, delete, publish, or message through signed-in accounts.
Reelcraft's USD budget controls do not limit those external side effects. Multi-user deployment is
unsupported without isolated Codex accounts, BrowserOS profiles, workers, and filesystem/process
boundaries.
