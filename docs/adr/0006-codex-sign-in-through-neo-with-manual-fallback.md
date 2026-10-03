# ADR-0006: "Connect Codex" signs in through BrowserOS Neo, with a manual fallback

**Date**: 2026-10-03 (recorded; decided while planning the Settings page, PR #50, Oct 2026)
**Status**: accepted (the Neo automation is still untested against OpenAI's real page, see "Risks")
**Deciders**: napstar-420, Claude

## Context

Reelcraft can use the user's ChatGPT plan through the `codex` CLI (installed in the image, its login kept in
`$CODEX_HOME=/data/codex`) and through BrowserOS Neo, a browser that runs on the user's own computer and
exposes an MCP server. Signing Codex in used to mean running
`docker exec -it -u reelcraft reelcraft codex login --device-auth` in a terminal. Reelcraft doesn't bundle Neo
and never holds the user's ChatGPT credentials: the user stays signed in to ChatGPT in their own Neo, and
Codex only stores its own token in the volume.

## Decision

- **ChatGPT sign-in only**, from **Settings → Codex → Connect Codex** (`CodexLoginService`,
  `apps/api/src/provider/codex/`). It runs `codex login --device-auth` as the API user and parses the sign-in
  link and one-time code from the output (ANSI codes stripped). One sign-in runs at a time (409 otherwise): it
  waits up to 30 s for the code and up to 16 min in total (codes last 15 min).
- **Neo first, manual fallback.** Reelcraft asks Neo to open the link in a new tab and type the code
  (`codex-device-page.ts`, run through `NeoClient.run`). **The user approves the sign-in in Neo; Reelcraft
  never clicks the consent button.** The code is only ever sent to a page on `https://auth.openai.com`. If Neo
  is unreachable, the page asks for a sign-in first, or the script can't find the code box, the Settings page
  shows the link and a copyable code so the sign-in can finish in any browser, and says why Neo didn't.
- **Neo is registered with Codex** so Codex browser stages can use it: after a successful sign-in, and whenever
  the Neo address is saved, `CodexNeoRegistrar` runs `codex mcp add <name> --url <address>`
  (`<name>` is `CODEX_BROWSER_EXTENSION`, default `browseros-neo`). It records the address it registered in the
  `codex.neoMcpUrl` setting and only ever replaces its own entry; an entry the user configured is left alone.
- **Status** comes from `codex login status` (exit code 0 means logged in), the readiness check (text, image
  and browser capabilities, each with its reason when unavailable) and the registrar. **Sign out** runs
  `codex logout`.
- No profile is created: `codex exec --profile reelcraft` works without a matching entry (checked with
  codex-cli 0.159.3).

## Alternatives Considered

### Alternative 1: Keep the terminal command only

- **Why not**: too hard for the target users. It stays documented as a fallback.

### Alternative 2: Neo only, no manual fallback

- **Why not**: the user first asked for "ChatGPT sign in only via BrowserOS Neo", then chose "Neo first, manual
  fallback". Neo may not be running, may be signed out of OpenAI, or the page markup may change; sign-in
  must not be blocked on a script that depends on a third party's DOM.

### Alternative 3: Sign in with an OpenAI API key

- **Why not**: out of scope. The point is to use the ChatGPT plan; paid API keys have their own path (ADR-0005).

## Consequences

### Positive

- A non-developer can connect Codex in two clicks, and the consent decision stays with the user.
- Everything that knows the OpenAI page's DOM is in one file (`codex-device-page.ts`).

### Negative

- Reelcraft depends on `codex login --device-auth`'s text output and on OpenAI's device page. Both can change.
- The in-container `codex` CLI and the Neo registration persist in `/data/codex` (`config.toml`).

### Risks

- **The Neo automation has not been run against the real OpenAI device page.** The sandbox couldn't reach
  `auth.openai.com`; the parser and scripts have unit tests only. GitHub issue #53 is the manual test checklist.
  If it fails, fix `enterDeviceCodeScript` (selectors, button text); the manual fallback keeps sign-in usable.
- Neo's own menu names for its MCP server weren't checked (the sandbox couldn't reach its docs). The user guide
  describes it in general terms.
