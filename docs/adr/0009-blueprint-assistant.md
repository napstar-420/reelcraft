# ADR-0009: The blueprint assistant is a tool-calling agent in the canvas, Codex first

**Date**: 2026-10-06
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

Building a blueprint means adding and wiring stages by hand. We want a chat in the blueprint canvas where
an LLM builds and edits the blueprint instead. It must not invent stage types, models or settings: Reelcraft
ships new releases often, and what a given install can do (stage types, models, assets, Characters) depends
on that install. A hosted ChatGPT or Claude.ai connector can't reach Reelcraft: it runs on the user's own
computer with no login (ADR-0002) and must not be put on the internet.

## Decision

- **A chat panel in the canvas, driven by an agent in the API.** The agent is behind a provider-neutral
  `AssistantAgent` interface (`apps/api/src/assistant/agent/`). **Codex** is the first adapter, through
  `codex app-server`; a Claude adapter (Agent SDK) can be added without touching the tools, storage or UI.
- **The model learns the app from tools, not from memory or a prompt.** Twelve tools read the running app
  (stage types and their config schemas, models, builtin checks, styles, the channel's assets and
  Characters, the blueprint's current draft, an authoring guide). They only wrap existing services, so they
  are right for whatever version is installed, with no per-release sync. Tool inputs are narrowed to the live
  registries, and every proposal must pass the real blueprint validator before the user sees it.
- **The agent only proposes.** `propose_draft` and `update_metadata` store a proposal; they never write the
  working draft or save a version. In **manual** mode the user clicks Apply; in **auto** mode the open canvas
  applies a valid proposal itself (if the canvas still matches the draft it was built on) and offers Undo.
  The server never writes `workingDraft`: the browser holds the unsaved edits. `PUT working-draft` names the
  saved version the draft was based on and is refused (409) once a newer save exists, so a stale tab or an
  Undo can't put an old graph over a save; a server-side write would also race the canvas's autosave.
- **Questions are a Reelcraft tool, `ask_user`, that ends the turn.** The UI shows the options plus a free-text
  "Other…"; the answers arrive as the next turn. Codex's own `request_user_input` is denied. Nothing blocks, so
  interrupt, API restart and chat deletion need no special handling.
- **Chats run in the API process, not through Inngest.** A turn is not run state, and a Codex turn is a live
  two-way conversation with tool callbacks that can't be split into durable steps. The durable parts are the
  Codex thread (resumable by id in a new process) and the items stored in `assistant_item`. A turn cut off by
  a restart is marked `interrupted` at boot. This is a deliberate exception to "run state changes flow through
  Inngest".
- **Codex is locked down.** One shared `codex app-server` is started with the built-in features turned off
  (shell, files, browser and computer use, web search, plugins, hooks, memories, sub-agents), every MCP server
  in the user's Codex config switched off (BrowserOS Neo is registered there with the user's signed-in
  accounts), a read-only sandbox, no environment, an empty working directory, and every request we don't
  expect denied. At startup the agent asks Codex for its MCP status and refuses to run if any server still
  exposes tools. `code_mode_host` stays on: dynamic tools run through it.
- **Codex 0.160.0.** The image pins it (`docker/app/Dockerfile`), because dynamic tools are an experimental
  protocol and were verified there.

## Alternatives considered

- **A skill and an MCP server installed in ChatGPT or Claude.ai.** Needs a public URL. Reelcraft has no auth
  and holds provider keys. A local stdio MCP for Claude Desktop or Claude Code is still possible later, over
  the same tools, as a separate process.
- **Putting the whole app description in the prompt, or a knowledge base updated on each push.** Goes stale
  for any install on another release, which is the hallucination we want to avoid, and costs tokens every turn.
- **Single-shot structured output.** Works with any text provider, but the model can't look things up, so it
  must be told everything up front.
- **ChatGPT through BrowserOS Neo as the assistant.** One text box, no tools, no session we control.
- **A server-side auto-apply that writes the working draft.** Races the canvas's debounced autosave and can't
  see unsaved edits.
- **Blocking `ask_user` until the user answers.** Needs a timeout policy, and a long-blocking tool call may be
  cut off by Codex; ending the turn is simpler and survives restarts.
- **A separate package for the assistant.** Every tool calls Nest services in `apps/api`, and packages can't
  import from `apps/*`, so a package would duplicate that or go over HTTP.

## Consequences

- Dynamic tools are experimental in Codex, so every Codex version bump must re-run
  `acceptance:codex-assistant` (lockdown, tool calls, `ask_user`, resume in a new process).
- A new stage type needs a line in the authoring guide, or `guide.test.ts` fails. That is how the assistant
  stays current with each release.
- Chat content (blueprint drafts, asset and Character names) goes to the signed-in Codex account, under its
  terms and usage limits. Provider keys and settings never do.
- Only one `codex app-server` serves all chats, so a crash fails the turns running on it. It restarts on the
  next turn, and three crashes within a minute make the assistant unavailable for a minute.
- Chats live in one API process (the event stream is in memory and reaches the browser over Socket.IO, ADR-0010).
