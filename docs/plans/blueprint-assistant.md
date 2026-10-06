# Blueprint Assistant

Status: implemented (PRs #80–#85). This is the as-built description. The decision and its
alternatives are in [ADR-0009](../adr/0009-blueprint-assistant.md); the user-facing page is
`apps/docs/docs/blueprints/assistant.md`; the Codex specifics are in
[`docs/codex-provider.md`](../codex-provider.md).

## What it is

A chat in the blueprint canvas (the **Assistant** tab) with an agent that reads the blueprint, looks
things up through Reelcraft tools, and proposes drafts the validator has already accepted. The agent
layer is provider-neutral (`AssistantAgent`); **Codex** is the first adapter and a Claude adapter can be
added without touching the tools, storage or UI.

The user stays in control. The agent only proposes. Nothing becomes a version without **Save**.

- **Manual** mode: a valid proposal waits for **Apply**.
- **Auto** mode: the open canvas applies a valid proposal itself, unless the canvas changed since the
  proposal was built; every apply offers **Undo**.

## No hallucination: how

| Mechanism                                                                                                                                                                                                                                                                | Guarantee                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Instructions say the model knows nothing and must look everything up                                                                                                                                                                                                     | The default path is a tool call, not memory                 |
| Tools read the running app's registries                                                                                                                                                                                                                                  | Always matches the installed version; no per-release sync   |
| Tool inputs are narrowed to the live registries (capability keys, check keys, style ids, guide topics)                                                                                                                                                                   | An unknown stage type is rejected before any handler runs   |
| `propose_draft` runs the real validator and refuses drafts with errors; it also reports invented fields that Zod would silently drop                                                                                                                                     | The model fixes its own mistakes in the same turn           |
| An authoring guide (`read_guide`), including **what Reelcraft cannot do**                                                                                                                                                                                                | Semantics the schemas can't express; honest "can't" answers |
| `guide.test.ts` fails CI when a capability, builtin check, Ref kind or artifact kind is missing from the guide, and validates the guide's example drafts with the real validator                                                                                         | The guide can't fall behind the code                        |
| An assistant-only quality gate (`tools/quality-checks.ts`): `propose_draft` refuses text stages without a system prompt, data outputs without properties, and model stages with no check, QC or approval; the guide's `quality` topic teaches where each control belongs | Good blueprints by default, not only valid ones             |
| A human applies (or auto-apply with Undo)                                                                                                                                                                                                                                | Nothing reaches a version unreviewed                        |

Model, asset and Character ids are not enums in the tool schemas (they change during a session); the
validator, `list_models` and `get_channel_resources` cover them.

## Tools (12)

Defined once (`apps/api/src/assistant/tools/`), each with a Zod input and a hand-written JSON Schema.
`tools.test.ts` keeps the two in step (Zod 3 has no JSON Schema output, like `BUILTIN_CHECKS`).

| Tool                                  | Kind     |                                                                                                                                                                                                    |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_blueprint`                       | read     | name, description, tags, **the current draft** (the proposal in this turn, else the canvas as sent with the turn, else the saved working draft, else the latest version), its validation, versions |
| `list_capabilities`, `get_capability` | read     | stage types; one type's config schema, slots and allowed outputs for a config                                                                                                                      |
| `list_models`                         | read     | usable models per provider, modalities, unavailable reasons, efforts, input kinds                                                                                                                  |
| `list_checks`, `list_styles`          | read     | builtin checks with params schemas; caption/text styles                                                                                                                                            |
| `get_channel_resources`               | read     | channel defaults, assets, Characters                                                                                                                                                               |
| `read_guide`                          | read     | a guide section (`overview`, `stage-types`, `refs`, `templates`, `outputs`, `iterate`, `checks-qc`, `models`, `inputs-roles`, `timelines`, `limits`, `examples`)                                   |
| `validate_draft`                      | read     | the validator's issues for a complete draft                                                                                                                                                        |
| `propose_draft`                       | write    | validates, then stores a **proposal** (never the working draft)                                                                                                                                    |
| `update_metadata`                     | write    | proposes a new name, description or tags                                                                                                                                                           |
| `ask_user`                            | interact | 1-4 questions with options; the UI adds a final **Other…** text option. **Ends the turn**; the answers arrive as the next turn                                                                     |

After `ask_user` in a turn, the write tools are refused. The blueprint a turn works on is bound
server-side: the model can't address another one.

## Turns

- Chats live in the API process, not Inngest (see ADR-0009). One turn per chat at a time (409
  otherwise), capped at 20 minutes. A turn cut off by a restart is marked `interrupted` at boot.
- `POST …/turns` carries the canvas draft; tools read that snapshot, never the server's working draft.
  A draft proposal records the item it was built on (`baseItemId`), so the canvas can tell whether it
  still matches.
- The browser applies draft proposals through the canvas's own `replaceDraft` path (autosave,
  validation and Save work as usual, plus an immediate working-draft write). The server never writes
  `workingDraft`: it can't see unsaved edits, and `PUT working-draft` is a blind overwrite. Metadata
  proposals are applied by the server on `…/apply` (name conflict → 409).
- Items (user message, agent message, tool call, proposal, question, turn status) are stored in
  `assistant_item` in `seq` order; text deltas stream but aren't stored. Events go over SSE; a
  reconnecting client refetches the chat.

## Data

`assistant_session` (blueprint, provider, provider session id, app version, tools hash, apply mode,
status, model, effort, title) and `assistant_item` (session, turn, `seq`, type, state, payload).
`deleteAssistantCascade` (`apps/api/src/assistant/assistant-cascade.ts`) runs in blueprint and channel
delete; `channel-delete-cascade.e2e.test.ts` asserts it. A chat whose app version or tool set no longer
matches is reported `stale` and the panel offers **Start new chat**.

## API

`GET /assistant/providers`; `GET|POST /blueprints/:id/assistant/sessions`;
`GET|PATCH|DELETE /assistant/sessions/:sid`; `POST …/turns` (202; `text` and/or `answer`, the canvas
`draft`, `model`, `effort`); `POST …/interrupt`; `POST …/proposals/:itemId/apply` (idempotent);
`GET …/events` (SSE). DTOs: `packages/shared/src/dto/assistant.dto.ts`.

## Codex

One shared `codex app-server --stdio`, tools registered as dynamic tools, threads resumable in a new
process, and a lockdown (built-ins off, every MCP server off including BrowserOS Neo, read-only
sandbox, no environment, unexpected requests denied, startup self-check). Details and what was
verified on codex-cli 0.160.0 (now pinned in the image): `docs/codex-provider.md`. After a Codex
upgrade, run `acceptance:codex-assistant`.

## Where the code is

|                                                                                           |                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/shared/src/dto/assistant.dto.ts`                                                | DTOs, proposal and question payloads                                               |
| `apps/api/src/assistant/`                                                                 | `AssistantModule`: tools, guide, instructions, service, controller, events, agents |
| `apps/api/src/provider/codex/codex-rpc.ts`                                                | app-server JSON-RPC, shared with model listing                                     |
| `apps/web/src/components/canvas/assistant/`, `hooks/useAssistant.ts`, `lib/draft-diff.ts` | the panel                                                                          |
| `apps/api/test/acceptance/codex-assistant.mjs`, `assistant-eval.mjs`                      | opt-in checks against a real Codex                                                 |

Not a separate package: every tool calls Nest services in `apps/api`, and packages can't import from
`apps/*`. A separate package would fit a future local stdio MCP server for Claude Desktop or Claude
Code, which would talk to the API over HTTP.

## Later

- A Claude adapter behind `AssistantAgent` (Agent SDK, tools as SDK MCP tools; its own sign-in).
- A local MCP server exposing the same tools to external clients.
- A canvas **Preview** of a proposal before applying.
- JSON-Patch replies if drafts get large enough that resending the whole draft costs too much.
- Shared event bus (Postgres LISTEN/NOTIFY) if Reelcraft ever runs more than one API process.

## Decisions taken along the way

- Auto-apply is client-side (above); `ask_user` doesn't block; ChatGPT-via-Neo dropped as an assistant
  provider (no tools); the assistant can edit name, description and tags; no entry on the Create
  blueprint form; Codex bumped to 0.160.0 in the image.
- `-c mcp_servers.<n>.enabled=false` alone makes Codex exit ("invalid transport"). Each override repeats
  the server's own command or url.
- Codex's `isDefault` model isn't always enabled for the account, so the picker defaults to the model in
  the user's Codex config (`config/read`).
