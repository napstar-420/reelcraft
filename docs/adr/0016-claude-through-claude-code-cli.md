# ADR-0016: Claude runs through the Claude Code CLI, signed in with the user's Claude plan

**Date**: 2026-10-18
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Reelcraft already uses the user's ChatGPT plan through the `codex` CLI (ADR-0006) for text, image and browser
stages and for the blueprint assistant (ADR-0009). Users with a Claude plan wanted the same for Claude. Claude
has no image generation, so it can serve every capability except `image.*`. The user asked to use only the
Claude Code CLI (`claude`), signed in the same way as Codex, and to let the assistant run on either.

## Decision

- **One CLI, the user's own login.** The image installs `@anthropic-ai/claude-code` (pinned) and keeps its
  login in `/data/claude` (`CLAUDE_CONFIG_DIR`, auto-updates off). No API key and no `KEY_PROVIDER` entry:
  stages and the assistant run on whatever account `claude auth login --claudeai` signed in. Usage is
  recorded at **$0**, like Codex.
- **"Connect Claude" through Neo, with a manual fallback** (`ClaudeLoginService`). It runs
  `claude auth login --claudeai`, which prints an authorize link (`claude.com/cai/oauth/authorize`) and waits
  for a code on stdin. Reelcraft opens the link in BrowserOS Neo; **the user signs in and approves, Reelcraft
  never clicks consent**. Reelcraft then watches that tab's address and, on Anthropic's callback page whose
  `state` matches the link's, types `code#state` into the CLI. Without Neo, the card shows the link and a box
  to paste the code. Status is `claude auth status --json` (the account email is not shown); sign out is
  `claude auth logout`.
- **Stages are durable CLI jobs, shared with Codex.** `CliJobProviderAdapter` (job directory per idempotency key,
  detached runner, `outputs/`/`progress/` confinement, continuation) now serves both CLIs; the runner picks a
  dialect per job (`codex exec --json` or `claude -p --output-format stream-json`). The provider's modalities
  are `text` and `browser`, which is what keeps Claude out of `image.generate`.
- **Locked-down jobs.** Every `claude -p` runs with `--setting-sources ""` (no user/project settings, hooks,
  plugins or CLAUDE.md), `--strict-mcp-config`, `--disable-slash-commands`, `--permission-mode dontAsk` and an
  explicit `--tools` list: none for text; `Read`, `Glob`, `Bash(ffmpeg|ffprobe *)` for a judge that inspects
  files; file tools, `Bash` and `mcp__browseros-neo` for browser jobs. Structured output uses `--json-schema`
  with the authored schema (no OpenAI strict-mode rewrite).
- **Neo is given per job**, as `--mcp-config` built from `SettingsService.browserOsUrl()` (with the loopback
  `Host` header Neo requires). Nothing is registered in Claude's config, so there is no registrar. The Neo
  lock moved to the workspace root so Codex and Claude browser jobs share one browser session.
- **The assistant runs one `claude -p` per turn**, resuming the chat by id (`--session-id` first, `--resume`
  after). Reelcraft's tools are served over MCP from a loopback HTTP endpoint (`AssistantToolServer`) that
  answers only the running turn, behind a per-turn bearer token. Claude gets `--tools ""` and only
  `mcp__reelcraft`; the agent refuses to run if Claude's `init` event lists any other tool or MCP server. Tool
  pictures go back as MCP image content, which Claude sees (no `turn/steer` workaround). The chat's tool list
  is kept in `WORKSPACE_ROOT/claude-assistant/` so a chat continues after a restart.

## Alternatives Considered

### Alternative 1: An Anthropic API key through `KEY_PROVIDER`

- **Why not**: the user chose to mirror Codex: use the Claude plan they already pay for, signed in once.

### Alternative 2: The Claude Agent SDK for the assistant

- **Why not**: its current release needs zod 4 as a peer dependency (Reelcraft is on zod 3) and ships a native
  CLI binary per platform next to the one in the image. Driving the pinned `claude` directly needs only the MCP
  SDK Reelcraft already uses.

### Alternative 3: Register Neo in Claude's config, like Codex

- **Why not**: a per-job `--mcp-config` always uses the current address, needs no ownership bookkeeping, and
  lets `--strict-mcp-config` keep everything else out.

## Consequences

### Positive

- Every non-image capability, and the assistant, can run on a Claude plan with no per-use bill.
- Codex and Claude share one tested job lifecycle; a third agent CLI is a dialect and a thin adapter.
- Nothing the user configured in Claude Code (hooks, plugins, MCP servers, CLAUDE.md) leaks into Reelcraft jobs.

### Negative

- Reelcraft depends on the `stream-json` event shapes (`system/init`, `stream_event`, `assistant`, `result`)
  and on `claude auth login`'s output and callback page. `claude-command.ts`, `claude-login-page.ts` and the
  assistant agent are the places to fix when they change.
- A new process per assistant turn adds start-up time compared to Codex's long-lived app-server.

### Risks

- **Anthropic's terms** for using a subscription login in third-party tools: Reelcraft only drives the official
  CLI on the user's own machine with their own login, but the user should check their plan's terms.
- **Claude Code updates**: the image pins the version; re-run `acceptance:claude` and
  `acceptance:claude-assistant` before bumping it.
