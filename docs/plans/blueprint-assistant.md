# Blueprint Assistant — Spec (v2: tool-calling agent)

Status: draft for review
Baseline: `main` at `01d3e78` (blueprint packages merged, PR #78)
Supersedes: v1 of this file (single-shot structured output via ChatGPT). Dropped: ChatGPT can't
call tools and has no session we control.

## 1. Outcome

Inside the blueprint canvas, a chat panel connects the user to an agent that:

- knows **which blueprint** it's working on, and can read the current canvas draft at any moment;
- **calls tools** to look up what this install can do (stage types, models, checks, styles, assets,
  Characters, rules) instead of relying on training data;
- **proposes drafts** through a tool that validates them with the real validator and returns the
  issues, so it can fix its own mistakes in the same turn;
- keeps a **session** per blueprint with full chat history, resumable across page reloads and API
  restarts;
- runs on **Codex** first. The agent layer is provider-neutral, so **Claude** (Agent SDK) can be
  added as a second adapter without touching the tools, UI or storage.

The user stays in control: proposals appear as reviewable changes, **Apply** writes the canvas's
working draft, and **Save** still creates the version (only Save creates a version).

## 2. Non-goals (v1)

- ChatGPT (browser) as an assistant provider.
- Hosted MCP connectors for ChatGPT or Claude.ai. Reelcraft has no auth and must stay off the
  internet (ADR-0002).
- Running blueprints, approving gates or editing runs from chat.
- Creating channel-level things (Characters, assets, channel defaults). The agent may reference
  them, not create them.
- Moving a session between providers mid-conversation. Switching provider starts a new session.

## 3. Research findings (Codex app-server, verified 2026-10-06)

Probed against `codex-cli 0.160.0` with the user's local login. The probe script is kept in the
PR description, not committed.

| Question | Finding |
|---|---|
| Can a client give Codex its own tools? | **Yes.** `thread/start` takes `dynamicTools: [{type:'function', name, description, inputSchema}]`. When the model calls one, app-server sends the client a JSON-RPC **request** `item/tool/call {threadId, turnId, callId, tool, arguments}`; the client replies `{success, contentItems:[{type:'inputText', text}]}`. It's experimental (`capabilities.experimentalApi: true`), which `CodexAppServerClient` already sends. |
| Does the session keep history? | **Yes.** Threads persist in `$CODEX_HOME` rollouts. A **new** app-server process can `thread/resume {threadId}` and continue with full history. |
| Do dynamic tools survive resume? | **Yes.** After resume in a fresh process the model called both tools without them being re-sent (`ThreadResumeParams` has no `dynamicTools` field; they're stored with the thread). |
| Can we lock Codex down to *only* our tools? | **Mostly.** Defaults expose shell, `apply_patch`, web search, image gen, plugins, sub-agents, hooks, MCP servers. Spawning app-server with `--disable` for `apps browser_use browser_use_external computer_use goals hooks image_generation memories multi_agent plugins remote_plugin shell_tool unified_exec skill_search tool_suggest sleep_tool skill_mcp_dependency_install` and `-c web_search="disabled"`, plus `sandbox:'read-only'`, `approvalPolicy:'never'`, and `environments: []` **on every `turn/start`** (it isn't kept across resume), left only: our tools, `wait`, `request_user_input`, MCP resource readers (no servers), and `collaboration.*` sub-agent tools. |
| Gotcha | Dynamic tools are invoked **through the code-mode host** (`functions.exec`). Disabling `code_mode_host` breaks them ("code-mode host is disabled"). Keep it on. |
| Streaming | Notifications: `turn/started`, `item/started` / `item/completed` (types `userMessage`, `agentMessage`, `reasoning`, `dynamicToolCall`), `item/agentMessage/delta`, `thread/tokenUsage/updated`, `turn/completed`. `turn/interrupt` cancels. `turn/start` accepts per-turn `model` and `effort`. |
| Questions to the user | `request_user_input` arrives as server request `item/tool/requestUserInput` with structured questions (`header`, `question`, `options`). It can be rendered as quick-reply chips. |

Image: `docker/app/Dockerfile` pins `CODEX_VERSION=0.159.3`. It has to be checked that 0.159.3 has
the same dynamic-tool protocol, or bumped to ≥0.160.0 (a runtime change → bump
`docker/app/RUNTIME_VERSION`).

## 4. Architecture

```
apps/web  AssistantPanel ──HTTP──▶  AssistantController ──▶ AssistantService
              ▲                         │  (sessions, turns, proposals, persistence)
              └──────── SSE ◀───────────┤
                                        ├──▶ AssistantAgent (interface)
                                        │       ├─ CodexAssistantAgent   (v1)
                                        │       ├─ FakeAssistantAgent    (tests)
                                        │       └─ ClaudeAssistantAgent  (later)
                                        └──▶ AssistantTools (provider-neutral)
                                                └─ BlueprintService, BlueprintValidator,
                                                   CapabilityRegistry, ProviderRegistry,
                                                   StyleRegistry, BUILTIN_CHECKS, channel/asset/
                                                   character services, guide
```

- **Tools are defined once**, in Reelcraft terms: name, description, input JSON Schema, Zod parser,
  handler. Adapters translate them to their native mechanism.
- **The agent never touches the database or services directly.** Everything goes through a tool
  handler running in the API process, with the session's `blueprintId` bound server-side. The
  model can't address another blueprint even if it tries.
- **Two histories, two owners.** The provider owns the model context (Codex rollout, Claude session
  file). Reelcraft owns the **transcript** it shows in the UI (messages, tool calls, proposals). The
  transcript is never replayed into the model. It exists for display, audit and Apply.

## 5. Provider-neutral agent interface

`apps/api/src/assistant/agent/assistant-agent.interface.ts`:

```ts
export interface AssistantToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;            // sent to the model
}

export type AssistantEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool.started'; callId: string; tool: string; args: unknown }
  | { type: 'tool.completed'; callId: string; tool: string; ok: boolean; result: unknown }
  | { type: 'question'; requestId: string; questions: AssistantQuestion[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'turn.completed' }
  | { type: 'turn.failed'; error: string };

export interface AssistantTurnHandlers {
  /** Runs a Reelcraft tool and returns its JSON result (or throws AssistantToolError). */
  callTool(tool: string, args: unknown): Promise<unknown>;
  onEvent(event: AssistantEvent): void;
}

export interface AssistantAgent {
  readonly providerId: string;                       // 'codex' | 'claude' | 'fake'
  listModels(): Promise<AssistantModel[]>;           // id, label, efforts
  /** Creates a provider session; returns its opaque id (Codex threadId). */
  startSession(opts: { instructions: string; tools: AssistantToolDef[] }): Promise<string>;
  runTurn(opts: {
    sessionId: string; text: string; model: string; effort?: string;
    handlers: AssistantTurnHandlers; signal: AbortSignal;
  }): Promise<void>;
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string>): Promise<void>;
}
```

This is deliberately the intersection of Codex app-server and the Claude Agent SDK: both have a
persistent session id, client-executed tools, streamed deltas, interrupt and token usage.

Registered with a Nest multi-provider token `ASSISTANT_AGENTS`. `AssistantService` picks by
`providerId`.

### 5.1 `CodexAssistantAgent`

- One **long-lived** `codex app-server --stdio` child per API process, started lazily, restarted on
  exit. Spawned with the isolation flags from §3, `--enable`d nothing extra. It reuses Codex login
  from `$CODEX_HOME` (the same login **Settings → Codex → Connect Codex** creates).
- MCP servers: `CodexNeoRegistrar` registers `browseros-neo` in the same `$CODEX_HOME`. The
  assistant must not get signed-in browser access, so spawn with
  `-c mcp_servers.<name>.enabled=false` for every server returned by `mcpServerStatus/list`. On
  startup, refuse to run turns if any server is still enabled.
- `startSession` → `thread/start {dynamicTools, developerInstructions, sandbox:'read-only',
  approvalPolicy:'never', environments:[], ephemeral:false}`.
- `runTurn` → `thread/resume` if the thread isn't loaded in this process, then `turn/start
  {threadId, input, model, effort, environments: []}`. It routes `item/tool/call` to
  `handlers.callTool`, maps notifications to `AssistantEvent`, and resolves on `turn/completed`.
  `signal` abort → `turn/interrupt`.
- A tool call for any name not in our registry, or any other server request
  (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, …), is **denied**
  and logged. That's defence in depth on top of the disabled features.
- Refactor: extract the JSON-RPC plumbing from `CodexAppServerClient` (today it's inline in
  `queryModels`) into a small `codex-rpc.ts` used by both model listing and the agent.

### 5.2 `ClaudeAssistantAgent` (later, for the interface's sake)

`@anthropic-ai/claude-agent-sdk` `query({ prompt, options: { resume: sessionId, mcpServers: {
reelcraft: createSdkMcpServer({ tools }) }, allowedTools: ['mcp__reelcraft__*'], permissionMode:
'default', settingSources: [] } })`. Tools map 1:1 to `tool(name, description, zodShape, handler)`
calling `handlers.callTool`. Auth would follow the Codex pattern (a **Connect Claude** sign-in in
Settings, or a key through `KEY_PROVIDER`). It needs its own ADR. Not built in v1, but the interface
must not need changes for it.

### 5.3 `FakeAssistantAgent`

A deterministic, scripted adapter (a list of steps: say X, call tool Y with Z, expect result
predicate). It's the default in tests and e2e, like the fake provider.

## 6. Tools

All handlers live in `apps/api/src/assistant/tools/`. Each has a Zod input schema and a
hand-written JSON Schema, with a drift test like `BUILTIN_CHECKS`'s `paramsSchema` (the codebase
avoids `zod-to-json-schema`). Results are compact JSON. Errors return
`{error, issues?}` with `success:false`, so the model can recover.

**Read (no side effects)**

| Tool | Input | Returns | From |
|---|---|---|---|
| `get_blueprint` | — | name, description, tags, **current working draft** (or latest version if none), its validation issues, version list (major.minor, runnable) | `BlueprintService.getBlueprint`, `listVersions`, `validateOnly` |
| `list_capabilities` | — | `[{key, label, description, modality, outputs}]` (short) | `CapabilityRegistry.list()` |
| `get_capability` | `{key}` | full: `configSchema`, slots + allowed outputs for a given config, `lockedSystemPrompt`, `requiresTemplate`, `interaction` | registry + `impl.slots(cfg)` / `allowedOutputs(cfg)` (as `POST /capabilities/:key/resolve`) |
| `list_models` | `{modality?}` | available models with `unavailableModalities` reasons, efforts, `inputKinds` | `ProviderRegistry` + `listModels()` |
| `list_checks` | — | builtin checks: key, description, `paramsSchema` | `BUILTIN_CHECKS` |
| `list_styles` | — | style ids + labels | `StyleRegistry.list()` |
| `get_channel_resources` | — | channel defaults (`ConfigLayer`), assets (id, name, kind), Characters (id, name, usable references) | channel / asset / character services |
| `read_guide` | `{topic}` | a section of the authoring guide (§7.3). `topic` is an enum | `guide.ts` |
| `validate_draft` | `{draft}` | `ValidationIssue[]` | `BlueprintService.validateOnly` |

**Write (proposal only)**

| Tool | Input | Effect |
|---|---|---|
| `propose_draft` | `{draft: CreateBlueprintVersionDto, summary: string}` | Validates. On any `error` issue: returns them, stores nothing. Otherwise: stores a **proposal** in the transcript (shown in the UI with Apply) and returns `{proposalId, warnings}`. Never writes the working draft. |

Long `configSchema`s stay out of every turn's context: the model asks for them through
`get_capability` only when it needs one. Codex's `deferLoading` flag on tool specs can be tried
later to trim the tool list itself.

Deliberately **not** tools in v1: `apply_draft` (the human does that), `save_version`, `run`,
`dry_run`. Dry run stays a canvas button on an applied draft.

## 7. Grounding: "knows every part of the app, never makes things up"

| # | Mechanism | Guarantee |
|---|---|---|
| 1 | **Instructions require looking things up**: "Never assume a stage type, setting, model, check or asset exists. Look it up with tools first. If something isn't available, say so." | The model's default path is the tools, not memory |
| 2 | **Tools read live registries** of the running install | Always matches the installed version. No per-release sync |
| 3 | **Narrowed input schemas**: `propose_draft`/`validate_draft` JSON Schemas are built per session with `enum`s for capability keys, model ids, builtin check keys, asset and Character ids | Unknown values are rejected before any handler runs |
| 4 | **`propose_draft` runs the validator** and refuses invalid drafts with `[{path, message}]` | The model fixes its own errors in the same turn. Nothing invalid reaches the user |
| 5 | **Authoring guide** via `read_guide` (refs, templates, iterate, checks vs QC vs approval, retry budgets, config layering, **what the app cannot do**) | Semantics the schemas can't express, and honest "can't do" answers |
| 6 | **Human Apply** | Nothing reaches the working draft or a version without the user |

### 7.1 Instructions

`developerInstructions` (Codex) / system prompt (Claude), built in `instructions.ts`:
- role and scope, plus the blueprint's id and name ("You are editing blueprint *X*. Only this one.");
- the workflow: `get_blueprint` → look up anything you'll use → `validate_draft` as you go →
  `propose_draft` → summarise the change in plain language;
- ask with `request_user_input` (Codex) / a question event when the request is ambiguous; never
  guess media models, durations or styles silently;
- refuse what's in the guide's "cannot do" list and say why;
- don't print raw JSON drafts in chat; the UI shows the proposal.

The app version and the date go in so the model can say what version it's describing.

### 7.2 Session vs freshness

A session lives for days. The blueprint, the registries and the available models can change in
between (an update, a Codex sign-out). That's fine, because the model reads them through tools
each time it needs them. Instructions tell it not to rely on earlier tool results from previous
turns. `get_blueprint` is cheap and should be called at the start of every turn.

Narrowed enums (layer 3) are fixed at `thread/start`. After an app update, the session's
`appVersion` no longer matches. The panel then offers **Start new chat**, and the validator
(layer 4) still catches stale values in the meantime.

### 7.3 Authoring guide

`apps/api/src/assistant/guide.ts` exports sections keyed by topic (`overview`, `refs`, `templates`,
`iterate`, `outputs`, `checks-qc-approval`, `retries`, `config-layers`, `inputs-roles`, `limits`,
`examples`). The `limits` section is the cannot-do list, from the code:

- `publish.stub` publishes nothing;
- no parallel stages; branching only via `enabledWhen` on a run input;
- `iterate.groupKey` is ignored; `iterate.over` a many-cardinality media source isn't supported;
- no QC on `media.video` output or on `human.input`;
- at most one role;
- can't create Characters, upload assets or change channel defaults.

`guide.test.ts` (CI) fails when any registered capability key, builtin check key, `Ref` kind or
`ArtifactKind` is missing from the guide, or an example blueprint stops validating. A new stage
type therefore can't ship without teaching the assistant about it, in the same PR, inside the same
image.

## 8. Sessions, turns and durability

### 8.1 Session

One **active** session per blueprint (older ones stay listed as history). It's bound to
`providerId`, an `externalSessionId` (Codex `threadId`), the Reelcraft `appVersion` at creation,
and the narrowed-enum hash. **New chat** starts a new session. Changing provider requires a new
chat. Model and effort can change per turn.

### 8.2 Turn

1. The client flushes the canvas autosave (`PUT working-draft`), then `POST …/turns {text, model,
   effort}`.
2. `AssistantService` rejects it if a turn is already running for this session (one at a time).
   Otherwise it records the user item and starts `agent.runTurn` **in-process**, without awaiting
   it in the request.
3. Events → persisted items (completed items only; deltas aren't stored) → pushed to the SSE stream.
4. Tool calls → `AssistantTools.call(session, name, args)` with `blueprintId` bound.
5. `turn.completed` / `turn.failed` → session idle.

### 8.3 Why not Inngest

Run state goes through the durable wakeup/outbox and Inngest pipeline. This isn't run state: it
creates no run, changes no run, spends no budget. More importantly, a Codex turn is a live
bidirectional stdio conversation with tool callbacks, which can't be split across Inngest steps.

The durable parts are the Codex thread and the Reelcraft transcript. If the API restarts
mid-turn, the in-flight turn is lost: on boot, any `running` turn is marked `interrupted`, and
the user sees "Interrupted — send again" with history intact. Recorded in the ADR as a deliberate
exception.

### 8.4 Cancel and questions

**Stop** → `AbortSignal` → `turn/interrupt`. A `question` event shows chips plus a free-text box.
The answer → `agent.answerQuestion`, and the turn continues.

## 9. Data model

`apps/api/src/db/schema/assistant.ts`:

```
assistant_session
  id                  ulid pk
  blueprint_id        fk → blueprint
  provider_id         text            -- 'codex'
  external_session_id text            -- Codex threadId
  app_version         text
  title               text null       -- first user message, trimmed
  status              'idle' | 'running'
  created_at, updated_at

assistant_item
  id            ulid pk
  session_id    fk → assistant_session (cascade)
  turn_id       text                 -- groups items of one turn
  seq           int                  -- order within session
  type          'user_message' | 'agent_message' | 'tool_call' | 'proposal' | 'question' | 'turn_status'
  payload       jsonb                -- text / {tool,args,ok,result(truncated)} / {draft,summary,warnings,baseDraftHash} / {questions,answers} / {status,error,model,effort,usage}
  applied_at    timestamptz null     -- proposals only
  created_at
```

- Cascade (CLAUDE.md rule): `assistant_session` references `blueprint`. Add it to blueprint delete,
  `ChannelService.delete()`, and `channel-delete-cascade.e2e.test.ts`. There are no files, so
  nothing goes to `storage_orphan`.
- **Delete chat** deletes the session rows and calls `thread/delete` on Codex (best effort).
- Not included in blueprint packages.

## 10. API

DTOs in `packages/shared/src/dto/assistant.dto.ts`:

| Method | Path | |
|---|---|---|
| `GET` | `/assistant/providers` | available agents + models + efforts + readiness (e.g. "Codex not connected") |
| `GET` | `/blueprints/:id/assistant/sessions` | list |
| `POST` | `/blueprints/:id/assistant/sessions` | `{providerId}` → new session |
| `GET` | `/assistant/sessions/:sid` | session + items |
| `DELETE` | `/assistant/sessions/:sid` | delete chat |
| `POST` | `/assistant/sessions/:sid/turns` | `{text, model, effort?}` → `{turnId}` (202) |
| `POST` | `/assistant/sessions/:sid/turns/:tid/interrupt` | stop |
| `POST` | `/assistant/sessions/:sid/questions/:qid` | `{answers}` |
| `POST` | `/assistant/sessions/:sid/proposals/:pid/applied` | marks applied (the draft goes through the existing `PUT working-draft`) |
| `SSE` | `/assistant/sessions/:sid/events` | `AssistantEvent` stream (same pattern as `RunController`'s `@Sse(':id/events')`) |

## 11. UI

`apps/web/src/components/canvas/assistant/`:

- **Panel**: a dock tab in `canvas-dock.tsx`. Contains a provider + model + effort picker, session
  menu (New chat, past chats, Delete chat), message list with streaming text, composer, and Stop.
- **Tool calls** as compact rows ("Looked up *Generate Image*", "Validated draft: 2 errors"),
  expandable.
- **Proposal card**: diff by stage `key` (+added / −removed / ~changed, expandable fields),
  warnings, **Preview** (highlight on canvas without applying), **Apply** (→ `PUT working-draft`,
  previous draft kept for canvas undo).
  - Conflict: if the working draft's hash differs from the proposal's `baseDraftHash`, show "The
    canvas changed since this was proposed" with Apply anyway / Cancel.
- **Questions** as chips + "Other".
- **Readiness**: if Codex isn't connected, the panel links to **Settings → Codex → Connect Codex**
  (deep link via `docs-url.ts` / settings route).
- After an app update: a banner with **Start new chat** (§7.2).

`apps/web` imports only types from `@reelcraft/shared`. The diff helper lives in `apps/web/src/lib/`.

## 12. Where the code lives

`apps/api/src/assistant/` as `AssistantModule`:

```
assistant.module.ts  assistant.controller.ts  assistant.service.ts
agent/  assistant-agent.interface.ts  codex-assistant.agent.ts  fake-assistant.agent.ts
tools/  index.ts  get-blueprint.ts  … propose-draft.ts  schemas.ts
guide.ts  guide.test.ts  instructions.ts
```

It imports `BlueprintModule`, `CapabilityModule`, `ProviderModule`, `DbModule` explicitly, and
the channel/asset/character modules. `CapabilityModule` must not import it back. Codex RPC is
shared with `provider/codex` via the extracted `codex-rpc.ts`.

**Not a separate pnpm package.** Every tool is a thin call into Nest services in `apps/api`.
Packages can't import from `apps/*`, so a package would duplicate that knowledge or go over HTTP.
The module boundary gives the same separation. The provider-neutral seam is the
`AssistantAgent` interface, which is where Claude plugs in. A separate package is right later for
a **local stdio MCP server** that exposes the same tools to external Claude Desktop / Claude Code
over HTTP to the API.

## 13. Security

- The agent's only reach into Reelcraft is the tool registry, and the only write is a *proposal*.
- Codex built-ins are disabled (§3), MCP servers are disabled per spawn (§5.1), sandbox is
  read-only, `environments: []` on every turn, and unexpected server requests are denied.
- **Acceptance check** (manual, per Codex version bump): ask the agent to list its tools and try
  a shell command. Expect only Reelcraft tools plus `wait` / `request_user_input` /
  `collaboration.*`, and a refusal. Same opt-in style as `acceptance:codex`.
- Data sent to the provider: blueprint content, asset and Character *names/ids*, channel defaults.
  Never provider keys, settings secrets or file contents.
- Tool results are data to the model. Asset names or prompt text written by the user could
  contain instructions, but the model can only propose a draft, which the human reviews.

## 14. Testing

- **Unit**: each tool handler (bound `blueprintId`, Zod rejects, enum narrowing), JSON Schema
  drift tests, `guide.test.ts`, `instructions.ts` snapshot, Codex event mapping (with a recorded
  JSON-RPC transcript from the probe as fixture), denial of unknown tools / server requests.
- **E2E** (`FakeAssistantAgent`): create session → turn → tool calls → invalid proposal refused →
  valid proposal stored → apply → working draft updated; interrupt; restart marks `interrupted`;
  blueprint and channel delete cascade.
- **Codex acceptance** (opt-in, `REELCRAFT_CODEX_ACCEPTANCE=1`): real thread, a 3-stage request,
  expect a valid proposal; resume in a new process; isolation check (§13).
- **Eval set** (manual): ~15 requests from simple to impossible ("publish to TikTok", "run in
  parallel"). Track valid proposals, rounds of `validate_draft`, honest refusals.

## 15. Docs and decisions

- **ADR-0009**: Blueprint assistant: provider-neutral agent with Reelcraft tools, Codex first.
  Covers: tools over prompt-stuffing, Codex dynamic tools + isolation, in-process turns (not
  Inngest), no hosted MCP (ADR-0002).
- `docs/codex-provider.md`: the assistant's app-server usage and isolation flags.
- User guide page (`apps/docs`) with exact labels: **Assistant**, **New chat**, **Apply**,
  **Preview**, **Stop**.
- `docs/build-progress.md`.

## 16. Phasing (one PR each)

1. **Tools + guide** (`feat(api)`): tool registry, handlers, schemas + drift tests, guide +
   `guide.test.ts`, `FakeAssistantAgent`. Testable with no model.
2. **Sessions + Codex agent** (`feat(api)`): tables, migration, cascade, `AssistantService`,
   controller + SSE, `codex-rpc.ts` extraction, `CodexAssistantAgent` with isolation, acceptance
   script. Codex version check / bump in the image (`RUNTIME_VERSION`).
3. **Panel** (`feat(web)`): chat, tool rows, proposal card with diff / Preview / Apply / conflict,
   questions, readiness.
4. **Quality + docs** (`docs`): eval pass, prompt / guide tuning, ADR-0009, user guide.

## 17. Risks

| Risk | Mitigation |
|---|---|
| `dynamicTools` is an **experimental** app-server API and may change between Codex versions | Pin `CODEX_VERSION`. A recorded-transcript unit test covers our mapping. The acceptance script runs on every bump |
| Feature-flag names change, re-exposing shell or browser | Deny unexpected server requests. Startup check of `mcpServerStatus/list`. Isolation acceptance check per bump |
| `collaboration.*` sub-agents stay exposed | They inherit the same tool set. Test whether a further flag removes them, and deny if a sub-agent asks for anything else |
| Context grows over long sessions | Codex compacts threads itself. **New chat** is one click |
| Codex usage limits | Turns surface Codex's error text. Show token usage per turn |

## 18. Open questions

- **Q1** Should the agent be allowed to apply directly (an "auto-apply" toggle), or always go through
  **Apply**? Recommendation: always Apply in v1.
- **Q2** Should it also edit blueprint metadata (name, description, tags)? Those sit outside
  `CreateBlueprintVersionDto`. It would be one more tool.
- **Q3** Should the assistant also be offered on the **Create blueprint** form ("describe it")?
  That would create the blueprint first, then open the canvas with a session.
- **Q4** Codex in the image: bump to ≥0.160.0 now, or verify 0.159.3 first?
