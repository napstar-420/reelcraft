# Claude Code CLI provider

The `claude` provider runs the user's signed-in Claude Code CLI (`claude -p`) as a durable job, for `text`
(including data and timeline outputs and QC judging) and `browser` stages. It never offers `image`. Why it is
built this way: ADR-0016.

## Jobs

`ClaudeProviderAdapter` extends `CliJobProviderAdapter` (`apps/api/src/provider/cli-job/`), the same job
lifecycle as Codex: one private directory per idempotency key under `WORKSPACE_ROOT/claude-jobs`, a detached
runner (`cli-job-runner.ts`) that survives API restarts, and output files confined to `outputs/` and
`progress/`. The runner reads `cli: 'claude'` from the request and uses `claudeDialect`
(`provider/claude/claude-command.ts`):

- arguments: `-p --output-format stream-json --verbose --model <alias> --effort <effort> --setting-sources ""
--strict-mcp-config --disable-slash-commands --permission-mode dontAsk --tools <list>`, plus `--allowedTools`,
  `--mcp-config` (browser jobs only: BrowserOS Neo from Settings), `--json-schema` (data, timeline and browser
  outputs) and `--resume <id>` or `--no-session-persistence`;
- the prompt (the same envelope as Codex) goes on stdin;
- `system/init` gives the session id a continuation resumes (`thread.json`); resuming works from any working
  directory;
- each `tool_use` block named `mcp__browseros-neo__*` counts as one browser step;
- the final `result` event is the answer: `structured_output` when a schema was sent, else `result`. An
  `is_error` result fails the job with its message, even on exit 0.

Models are the CLI's aliases (`sonnet`, `opus`, `fable`, `haiku`), so the list needs no upkeep; efforts are
`low`, `medium`, `high`, `xhigh`, `max`. Which models run depends on the user's plan. Estimates and
settlements are `$0`.

Readiness (`claude-runtime-readiness.ts`): `text` and `browser` need `claude auth status --json` to report
`loggedIn`; `browser` also needs Neo to answer. Timeouts, step and output limits reuse the `CODEX_*` job
settings.

## Connecting from the Settings page

**Settings → Claude → Connect Claude** (`ClaudeLoginService`) runs `claude auth login --claudeai` (with
`BROWSER=true`, so nothing opens on the server). Verified with Claude Code 2.1.286, without a TTY it prints:

```text
Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=…&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&…&state=…
Paste code here if prompted >
```

Reelcraft opens the link in Neo, the user signs in and approves, and Reelcraft polls the tab's address
(`browser.pages.getInfo`). On `https://platform.claude.com/oauth/code/callback?code=…&state=…` with the link's
`state`, it writes `code#state` to the CLI's stdin. If Neo can't help, the card shows the link and a box whose
value goes to `POST /api/claude/login/code`. A wrong code makes the CLI print `Invalid code. Please make sure the
full code was copied.` and exit 1, which the card shows. When signed out, `claude auth status --json` exits 1 and
still prints `{"loggedIn": false, …}`.

## The blueprint assistant on Claude

`ClaudeAssistantAgent` runs one locked-down `claude -p` per turn (`--tools ""`, `--allowedTools mcp__reelcraft`,
`--setting-sources ""`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--system-prompt` with
`--system-prompt-snapshot off` so the per-turn instructions apply, `--include-partial-messages` for streaming).
The first turn passes `--session-id <uuid>`, later ones `--resume <uuid>`. The chat's tool list is kept in
`WORKSPACE_ROOT/claude-assistant/sessions/<id>.json`.

Reelcraft's tools are served by `AssistantToolServer`: an MCP server (streamable HTTP, stateless) on
`127.0.0.1:<random port>/mcp` that answers only a bearer token registered by the running turn. Tool results
carry pictures as MCP `image` content, which Claude sees. If Claude's `init` event lists any tool not named
`mcp__reelcraft__*` or any other MCP server, the turn is refused. Stopping a turn kills its process.

After a Claude Code upgrade, re-run both opt-in acceptances. They use your Claude plan:

```bash
REELCRAFT_CLAUDE_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:claude
REELCRAFT_CLAUDE_ACCEPTANCE=1 pnpm --filter @reelcraft/api acceptance:claude-assistant
```

`acceptance:claude` runs text and a continued thread with structured output; add
`REELCRAFT_CLAUDE_BROWSER_ACCEPTANCE=1` for a BrowserOS Neo job. `acceptance:claude-assistant` checks the
lockdown, streaming, `ask_user` ending the turn, a chat resuming in a new agent, and a tool picture reaching the
model.
