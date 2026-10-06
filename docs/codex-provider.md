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

## Connecting from the Settings page

**Settings → Codex → Connect Codex** (`CodexLoginService`) runs `codex login --device-auth` as the
API user, so the login lands in that user's `$CODEX_HOME` (`/data/codex` in the image). The service
parses the sign-in link and one-time code from the CLI output, then asks BrowserOS Neo to open the
link and type the code (`codex-device-page.ts`). The code is only ever sent to an
`https://auth.openai.com` page. Reelcraft never clicks the consent button: the user approves the
sign-in in Neo. If Neo is unreachable, the page wants an OpenAI sign-in first, or the script can't
find the code box, the Settings page shows the link and code to finish in any browser. The code
expires after 15 minutes, and one sign-in runs at a time.

After a successful sign-in, and whenever the Neo address is saved in Settings,
`CodexNeoRegistrar` makes sure Codex has a `browseros-neo` MCP server (`codex mcp add browseros-neo
--url <address>`). It records the address it registered and only ever replaces that entry; an
entry the user configured is left alone. `codex exec --profile reelcraft` works without a matching
profile in `config.toml` (verified with codex-cli 0.159.3; the image now ships 0.160.0), so no profile is created.

## The blueprint assistant on Codex

The blueprint assistant (ADR-0009) doesn't use `codex exec`. It keeps one `codex app-server --stdio`
running and registers Reelcraft's tools as **dynamic tools** (`thread/start`). When the model calls one,
app-server sends `item/tool/call` and the API answers it. Threads persist in `$CODEX_HOME`, and
`thread/resume` in a new process keeps the history and the tools. Verified on codex-cli 0.160.0.

The process is locked down (`apps/api/src/assistant/agent/codex-app-server-args.ts`):

- `--disable` for the features that give the model a shell, files, a browser, web search, plugins, hooks,
  memories, sub-agents or apps. **Don't disable `code_mode_host`**: dynamic tools run through it ("code-mode
  host is disabled" otherwise).
- Every MCP server in Codex's config is switched off, including BrowserOS Neo. `-c mcp_servers.<name>.enabled=false`
  alone makes Codex exit with "invalid transport", so each override repeats the server's command or url:
  `-c 'mcp_servers.<name>={ url = "…", enabled = false }'`. At startup the agent asks `mcpServerStatus/list`
  and refuses to run if any server still has tools or resources.
- Threads use `sandbox: read-only`, `approvalPolicy: never` and `environments: []`. `environments` is not
  kept across a resume, so it is sent on every `turn/start` too. The working directory is an empty temp dir.
- Anything Codex asks us that isn't our own tool (approvals, `request_user_input`, elicitations) is denied.

What is still visible to the model: Reelcraft's tools, `wait`, `request_user_input` and the `collaboration.*`
sub-agent helpers (the instructions forbid them, and sub-agent threads can't call our tools).

After a Codex upgrade, re-run the opt-in acceptance. It checks the lockdown (shell, file and env access all
fail), that tool calls reach Reelcraft, that `ask_user` ends the turn, and that a thread resumes in a new process:

```bash
REELCRAFT_CODEX_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:codex-assistant
```

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
