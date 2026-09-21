# Phase 9.5 — Visual Blueprint Canvas: implementation progress

Plan: `docs/plans/phase-9.5-visual-canvas.md`
Branch: `codex/phase9.5-visual-canvas`

## Chunks

- [x] Chunk 1 — Backend baseline + canvas skeleton
- [x] Chunk 2 — Stage node CRUD (add / remove / reorder)
- [x] Chunk 3 — Binding picker (the `Ref` editor)
- [x] Chunk 4 — Inspector panel: capability config + slots/context
- [x] Chunk 5 — Checks editor
- [ ] Chunk 6 — Remaining StageDef fields (qc, retryLimit, approval, budget, model, enabledWhen, iterate)
- [ ] Chunk 7 — Live validation overlay + memory-edge arcs
- [ ] Chunk 8 — Save, create-new flow, and dry-run integration
- [ ] Chunk 9 — Template library integration

## Notes / deviations from plan

### Chunk 1

- `POST /blueprints` added to `BlueprintController` wrapping
  `BlueprintService.ensureBlueprint` unchanged; `CreateBlueprintDto`
  (`{channelId, name}`) added to `packages/shared/src/dto/blueprint.dto.ts`
  next to the existing blueprint DTOs — already re-exported via the
  package's `dto/index.ts` barrel, no barrel change needed.
- `@xyflow/react@^12.11.6` added as a normal (non-dev) dependency of
  `apps/web`; confirmed compatible peer deps (`react`/`react-dom >=17`)
  against this repo's React 18.3.1. Installed via `pnpm install` at the
  repo root (lockfile updated by the tool, not hand-edited).
- The required `@xyflow/react/dist/style.css` stylesheet is imported once,
  directly in `apps/web/src/pages/BlueprintCanvasPage.tsx` (not
  `main.tsx`) since that page is currently the only consumer of the
  library.
- `apps/web/src/api/client.ts` gained `createBlueprint`,
  `createBlueprintVersion`, `listBlueprintVersions`, and
  `validateBlueprint`. All four were confirmed missing before this chunk.
  `CreateBlueprintVersionDto`, `BlueprintVersionDto`, and `ValidationIssue`
  all import cleanly from `@reefcraft/shared`'s root barrel — no path
  surprises.
- `BlueprintCanvasPage.tsx` handles both routes in one component,
  branching on which route param is present:
  - `/channels/:channelId/build` (create-new): renders a small
    "Name your blueprint" form; no blueprint is created until the user
    submits a name. On success, the created `blueprintId` is held in
    `useState` on the same component instance, which switches it straight
    into edit-mode rendering — no navigation/route change, so a page
    refresh before saving a version would lose the in-progress id (this
    is fine for Chunk 1, since there is nothing to lose yet — the created
    blueprint has zero versions either way).
  - `/blueprints/:blueprintId/build` (edit-existing): calls
    `listBlueprintVersions`, seeds the draft from the highest-`version`
    entry's `graph`/`inputs`/`roles`/`defaults`/`budget`, or an empty
    draft (`{graph: [], inputs: [], roles: [], defaults: {}, budget:
{runCapUsd: 5}}`) when the list is empty.
  - The draft is plain local `useState`, seeded once via a guarded
    `useEffect` (no React Query mutation) per the chunk's spec.
- Canvas rendering: one node per `graph` entry positioned at
  `{x: index * 250, y: 100}`, `prev` edges computed between consecutive
  entries, `ReactFlow` wrapped in `ReactFlowProvider`, all interactivity
  props (`nodesDraggable`/`nodesConnectable`/`elementsSelectable`) forced
  `false` since this chunk is read-only by design. Empty graph renders a
  static "Add your first stage…" message, no button.
- `apps/web/src/components/canvas/` was not created as an empty directory
  — git doesn't track empty directories and this chunk adds no files
  there; it will be created naturally when Chunk 2 adds `StageNode.tsx`.
- `BlueprintsPage.tsx` gained a "Create custom blueprint" link to
  `/channels/:channelId/build`, added alongside (not replacing) the
  existing template list.
- New e2e test `apps/api/test/e2e/blueprint-create.e2e.test.ts` mirrors
  `blueprint-validate.e2e.test.ts`'s style: drives `BlueprintController`
  directly via `testApp.app.get(BlueprintController)` (no HTTP/supertest
  anywhere in this repo's e2e suite), covering create-returns-id,
  idempotency by `(channelId, name)`, and a standalone
  `CreateBlueprintDto.safeParse` check for empty-name rejection (calling
  the controller method directly bypasses the `ZodValidationPipe`, so DTO
  validation itself is tested against the schema directly rather than
  through the controller).
- Verification: `pnpm install`, `pnpm --filter @reefcraft/shared build`,
  `pnpm --filter @reefcraft/api typecheck`, the new e2e test (3/3 passed),
  the full e2e regression suite (31 files / 176 tests, all passed),
  `pnpm --filter @reefcraft/web typecheck`/`build` (both clean), `pnpm
lint` (0 errors, 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), and `pnpm format:check` (clean) — all run
  and all green.

### Chunk 2

- **Add-stage UI**: a single always-append "+ Add stage" button
  (`apps/web/src/components/canvas/AddStageMenu.tsx`) paired with a
  capability `<select>` mirroring `EditorPage.tsx`'s existing picker
  pattern (`useQuery(['capabilities'], api.listCapabilities)`, `<select>`
  keyed/valued by `c.key`). No between-nodes insert-anywhere affordance —
  appending at the end plus drag-to-reorder (already required by the
  chunk) reaches the same end state with less UI, per the plan's own
  "your call, but don't over-build" framing. On selection, calls
  `api.resolveCapability(key, {})` to get `allowedOutputs` and builds the
  new `StageDef` client-side.
- **Delete controls**: no custom `@xyflow/react` node type — kept the
  default node renderer and added a plain `<ul>` of
  `{label} [Delete button]` rows above the canvas in `StageGraphCanvas`
  (`BlueprintCanvasPage.tsx`), one per stage in array order. Simpler than
  a custom node renderer per the chunk's own "simplest approach
  preferred" guidance; `StageNode.tsx` was therefore **not created** —
  the plan listed it as conditional on introducing a custom node
  renderer, which this chunk doesn't need.
- **Key generation**: `stage-${n}` picking the smallest `n >= 1` whose
  key isn't already present in the graph (linear scan building a `Set` of
  existing keys, then incrementing until free). Not user-editable in this
  chunk, per the task spec.
- **Reorder**: `nodesDraggable` flipped to `true` (was `false`);
  `onNodeDragStop` translates the dropped node's `position.x` back to a
  target index via `Math.round(x / 250)`, clamped to `[0, graph.length -
1]`, then a pure `moveStage(graph, fromIndex, toIndex)` helper
  (splice-out/splice-in) reorders the draft's `graph` array. `node.position`
  itself is never persisted — the next render recomputes canonical
  positions from the new array order via the existing `stageNodes()`,
  which snaps the node back onto the trunk (intended per Locked Decision
  5, not a bug).
- **Default `output.kind`**: `defaultOutput()` in `AddStageMenu.tsx`
  picks the first non-`'data'` entry of `allowedOutputs` (falling back to
  the first entry if it isn't `'data'`, or to a placeholder
  `{kind: 'data', schema: {type: 'object'}}` if `'data'` is the only
  allowed kind) — matches the task spec's stated fallback exactly; a real
  schema builder is deferred to Chunk 4.
- All three actions (add/delete/reorder) update the single `draft` state
  already held in `EditBlueprintCanvas`'s `useState`; handlers are defined
  there and passed down as props to `StageGraphCanvas`/`AddStageMenu` —
  no new state was introduced, no React Query mutation used (draft stays
  local per Chunk 1's pattern).
- No unit tests added for `moveStage`/key-generation — this repo has no
  test runner configured for `apps/web` (confirmed in Chunk 1 and
  reconfirmed here); the plan's "small set of pure-function unit tests"
  exit criterion is deferred until such a runner exists, consistent with
  Chunk 1's precedent of relying on typecheck/build/lint/format as the
  full automated gate for this package.
- Verification: `pnpm --filter @reefcraft/shared build` (clean, no
  changes needed), `pnpm --filter @reefcraft/web typecheck` (clean),
  `pnpm --filter @reefcraft/web build` (clean, same pre-existing
  chunk-size warning as always, unrelated), `pnpm lint` (0 errors, the
  same 1 pre-existing unrelated warning in `media-output.e2e.test.ts`),
  `pnpm format:check` (clean) — all green.

### Chunk 3

- **`BindingPicker` props landed exactly as scoped**:
  `{ value: Ref; onChange: (ref: Ref) => void; stageIndex: number; graph:
StageDef[]; inputs: InputDef[]; roles: RoleDef[]; assets: Array<{id:
string; name: string}>; iterating: boolean }` (`apps/web/src/components/canvas/BindingPicker.tsx`).
  Step 1 is a `<select>` of `Ref['from']` filtered by
  `availableRefKinds(stageIndex, iterating)` — `prev` hidden entirely on
  `stageIndex === 0` (covers the plain and `alignWith` variants together,
  since both are the same `from`); `item`/`prevItem` hidden unless
  `iterating`. Step 2 renders per the plan's kind → widget mapping;
  `alignWith`'s checkbox is only shown when `graph[stageIndex - 1]?.iterate`
  is set. This filtering is UI convenience only, not a second validator —
  `POST /blueprints/:id/validate` remains authoritative.
- **`const`** renders a single text input, stored/coerced as a `string`
  (no type-aware literal editor against the target slot's `accepts` —
  explicitly deferred per the task spec, not a gap).
- **New `apps/web/src/lib/memory-writers.ts`** — `deriveMemoryKeys(graph):
string[]`, the pure Locked-Decision-6 scan (`for stage of graph: for key
in stage.writes ?? {}`), deduped via a `Set`. **Flag for Chunk 4/7's
  implementer**: no chunk so far builds any UI to actually _set_
  `stage.writes` — the plan doesn't list it under Chunk 4's inspector
  scope either. Until something writes `writes`, a `{from:'memory'}`
  binding has no real key to pick and can't be exercised end-to-end
  through the UI (only by a graph seeded via the API/template path). This
  is a real gap, called out here rather than silently worked around.
- **`GET /blueprints/:id`** added to `apps/api/src/blueprint/blueprint.controller.ts`,
  backed by new `BlueprintService.getBlueprint(id)`
  (`apps/api/src/blueprint/blueprint.service.ts`) — a plain
  `db.select().from(blueprint).where(eq(blueprint.id, id)).limit(1)`,
  returning the full row. Not-found convention matches `getVersion`'s
  existing pattern exactly: `throw new Error(\`Blueprint ${id} not
  found\`)`(a plain`Error`, not a Nest `NotFoundException`— this repo's`blueprint.service.ts` had no HTTP-exception convention to match, only
this plain-`Error` one, already used twice before this chunk).
- **Client**: `api.getBlueprint(blueprintId)` (new `BlueprintDto` type,
  the whole `blueprint` table row shape) and `api.listChannelAssets(channelId)`
  (typed against the pre-existing `AssetDto` from `@reefcraft/shared` —
  no new DTO needed, confirmed it already matched the controller's raw
  row shape) added to `apps/web/src/api/client.ts`.
- **Demo harness**: `DemoBindingHarness` in `BlueprintCanvasPage.tsx`
  (`EditBlueprintCanvas`) — a stage-key `<select>` plus one `BindingPicker`
  bound to a local `useState<Ref>` demo value, fed `channelId` via a new
  `api.getBlueprint` query. Explicitly commented as temporary; Chunk 4's
  `StageInspector` replaces it entirely (not extends it).
- No unit tests added for `availableRefKinds`/`deriveMemoryKeys` — this
  repo still has no test runner configured for `apps/web` (reconfirmed,
  consistent with Chunks 1-2's precedent).
- Verification: `pnpm --filter @reefcraft/shared build` (clean),
  `pnpm --filter @reefcraft/api typecheck` (clean), new e2e test
  `blueprint-get.e2e.test.ts` (2/2 passed), full e2e regression suite
  (32 files / 178 tests, all passed — up from 31/176 by exactly the 1
  file / 2 tests this chunk added), `pnpm --filter @reefcraft/web
typecheck`/`build` (both clean, same pre-existing chunk-size warning),
  `pnpm lint` (0 errors, same 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), `pnpm format:check` (clean after
  `prettier --write` on the one new test file) — all green.

### Chunk 4

- **New `apps/web/src/components/canvas/SchemaForm.tsx`** — the generic
  no-code editor for any restricted-dialect `JsonSchema` value (Locked
  Decision 3), purely recursive on `schema.type`: `string`/`number`/
  `integer` → text/number input (`enum` short-circuits to a `<select>` for
  exactly these three types, matching the dialect's own shape — `enum` on
  `object`/`array`/`boolean` isn't a case the dialect produces, so it's not
  handled); `boolean` → checkbox; `object` → a `<fieldset>` recursing into
  `properties` (label = key, marked `*` if listed in `required`); `array` →
  a repeatable list of `items`-typed sub-forms with add/remove
  (add disabled at `maxItems`, remove disabled at/under `minItems`). Reused
  as-is for capability `config` and (this chunk's addition) `output.schema`.
- **New `apps/web/src/components/canvas/StageInspector.tsx`** replaces
  Chunk 3's `DemoBindingHarness` entirely (deleted, not extended) — the
  real editor for one selected stage's `key`/`label`/`capability`/`config`/
  `slots`/`context`/`output`/`writes`.
  - **`key` is not editable after creation** — the plan's own suggested
    simpler option, taken as-is: re-keying a stage would require rewriting
    every `{from:'prev'}`-adjacent reference by _position_ (fine, `prev` is
    positional) but also every other stage's checks/approval that might
    reference it by identity elsewhere in a later chunk; punting entirely
    avoids inventing a collision-check UI for a field nothing yet depends on
    being renamable. `label` is freely editable.
  - **Capability `<select>`** resets `config: {}` and `slots: {}` on
    change (matches the task spec exactly) — the next render's effect
    re-resolves against the new capability with an empty config.
  - **Debounced resolve**: a `useEffect` keyed on `[capability, configKey]`
    where `configKey = JSON.stringify(stage.config)` — content equality,
    not `stage.config`'s object identity, which changes on every draft
    edit (label, slots, context) even when `config` itself didn't change.
    400ms debounce (close to `TimelineEditorPage`'s existing 450ms
    precedent, not copied exactly since this is a network call with a
    different cost profile, not an autosave). Populates
    `{slots, allowedOutputs}` from `POST /capabilities/:key/resolve`;
    resolve failures reset to `{slots: [], allowedOutputs: []}` rather than
    leaving stale data.
  - **Slots**: one `BindingPicker` per resolved `SlotDef`, defaulting an
    unset slot to `{from: 'const', value: undefined}`; `required`/
    `cardinality` shown as plain text next to the label, no deeper
    `accepts` interpretation (per task spec).
  - **Context**: `Object.entries(stage.context)`, each row an editable key
    `<input>` (renaming overwrites silently on collision — no dedupe UI,
    consistent with "don't over-engineer" and no chunk before this one
    needing it) plus a `BindingPicker` for the value; "+ add context" picks
    the next free `context-N` key.
  - **`output.kind`** restricted to `resolved.allowedOutputs`; changing kind
    rebuilds the `OutputDef` via an exhaustive `switch` (needed because
    `OutputDef` is a discriminated union — spreading the old value across
    kinds doesn't type-check, e.g. a `text`→`data` change can't carry over
    a nonexistent `schema` field).
  - **`output.schema` (kind `'data'`)** — also edited via `SchemaForm`, but
    against a **new, hand-written, non-recursive `OUTPUT_SCHEMA_META`**
    constant (top-level `type`/`description`/`enum`/`required`/min-max
    fields only), not a fully general "schema of a `JsonSchema`". The
    restricted dialect has no `$ref`, so a schema literally describing
    "a `JsonSchema` value" can't recurse into its own `properties`/`items`
    without one — building nested object/array output schemas by picker is
    therefore out of scope for this chunk (flagged, not silently dropped);
    most capabilities don't emit `data` outputs with deep schemas anyway.
    This still satisfies "no JSON textarea anywhere" for the cases it
    covers.
  - **New addition — `writes` editor** (not in the original plan; flagged
    by Chunk 3's own progress notes as a real gap: nothing built any UI to
    set `stage.writes`, so a `{from:'memory'}` binding had no key to
    actually point at outside of API/template-seeded graphs). A small
    repeatable `{memoryKey, path}` list backed by `stage.writes:
Record<string,string>`, add/remove, free-form text inputs for both key and
    path (no picker needed — a memory key is user-invented text, not
    selected from an existing list, the way `BindingPicker`'s consuming
    side works via `deriveMemoryKeys`).
  - `BindingPicker`'s `stageIndex` is recomputed via `graph.findIndex`
    every render (not cached), so it stays correct across reorders.
- **`BlueprintCanvasPage.tsx`**: `DemoBindingHarness` deleted outright.
  `StageGraphCanvas` gained `elementsSelectable` (was `false`) and an
  `onNodeClick` handler reporting `node.id` (the stage key) via a new
  `onSelectStage` prop. `EditBlueprintCanvas` gained `selectedStageKey`
  state, an `updateStage(updated)` handler (immutable replace-by-key in
  `draft.graph`), and moved the channel-assets `useQuery` up from the old
  demo harness (now keyed off `blueprintMeta.data?.channelId` directly in
  this component, passed down as a plain prop). `deleteStage` now also
  clears `selectedStageKey` if the deleted stage was selected, so the
  inspector doesn't render against a stage key no longer in the graph.
- A closure-narrowing gotcha worth recording: inside `StageInspector`,
  `handleContextKeyChange` etc. are `function` declarations defined after
  an `if (!found) return null` guard on the `StageDef | undefined` lookup —
  TypeScript does not carry that narrowing into hoisted function-declaration
  closures (property-level narrowing like `stage.output.kind === 'data'`
  has the same limitation across any closure boundary, not just hoisted
  ones). Fixed by rebinding to a fresh `const stage: StageDef = found`
  right after the guard, and by not spreading `stage.output` when building
  a `'data'` output (constructing `{kind: 'data', schema}` directly instead
  of `{...stage.output, schema}`, since the spread's static type stays the
  full `OutputDef` union inside the callback).
- No unit tests added for `SchemaForm`'s recursion — still no test runner
  configured for `apps/web` (reconfirmed, consistent with Chunks 1-3).
- Verification: `pnpm --filter @reefcraft/shared build` (clean, untouched),
  `pnpm --filter @reefcraft/web typecheck` (clean), `pnpm --filter
@reefcraft/web build` (clean, same pre-existing chunk-size warning),
  `pnpm lint` (0 errors, same 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), `pnpm format:check` (clean after `prettier
--write` on the three files this chunk touched) — all green.

### Chunk 5

- **New `apps/web/src/components/canvas/ChecksEditor.tsx`** — one row per
  `stage.checks[i]`, a `type` `<select>` (`builtin`/`script`) that rebuilds
  a fresh default `CheckDef` on switch (mirrors `StageInspector`'s own
  capability-switch reset pattern rather than trying to carry fields across
  the discriminated union).
  - **`builtin`**: a `<select>` of `GET /check-types` entries filtered to
    `kind === 'builtin'` (same filter expression `CheckTesterPage.tsx`
    already uses), the selected builtin's `description` shown as help text,
    then `params` edited via Chunk 4's `SchemaForm` bound to that builtin's
    `paramsSchema`. `CheckTypeDto`'s builtin variant has `paramsSchema?:
JsonSchema` (confirmed optional in `apps/web/src/api/client.ts`) — a
    module-level `EMPTY_OBJECT_SCHEMA = {type: 'object'}` constant is
    substituted whenever it's absent or no builtin is selected yet, so
    `SchemaForm` always has a schema to render against (an empty object
    form: no fields, matching "no params" semantics rather than crashing
    or falling back to a textarea).
  - **`script`**: a `name` text input, a `<textarea>` for `code` (the one
    named exception, Locked Decision 3), and a `refs: Record<string, Ref>`
    editor (`RefsEditor`, a new local component in the same file) that
    copies `StageInspector`'s existing `Context` section's exact
    add/remove/editable-key pattern verbatim, one `BindingPicker` per named
    ref, threading through the same `stageIndex`/`graph`/`inputs`/`roles`/
    `assets`/`iterating` props `StageInspector` already has in scope.
  - **Test action**: a small per-row `CheckTestPanel` (artifact-id input +
    "Test" button + result rendering) that mirrors
    `CheckTesterPage.tsx`'s existing result JSX near-verbatim (pass/fail
    heading, kind/name line, message/fault lines, a `<pre>` for `details`)
    but is **not a literal extraction/import** — `CheckTesterPage`'s
    version is entangled with its own local `paramsText`/`scriptName`/etc.
    state and JSON-textarea construction of the `check` object, which this
    chunk explicitly must not reuse (Locked Decision 3). Re-deriving the
    ~15-line result-rendering block locally was simpler and lower-risk than
    extracting a shared sub-component out of `CheckTesterPage` under this
    chunk's own scope; `CheckTesterPage.tsx` itself is left untouched.
  - **Add-check flow**: two explicit buttons, "+ Add builtin check" / "+
    Add script check", each appending one default `CheckDef`
    (`{type:'builtin', key:'', params:{}}` / `{type:'script', name:'',
code:''}`) — chosen over a single type-then-add two-step flow since
    the type is already known at click time and two buttons is strictly
    less UI/state than a picker-plus-confirm.
- **`StageInspector.tsx`**: one new `<div><h3>Checks</h3>...</div>` section
  after "Memory writes", rendering `ChecksEditor` bound to `stage.checks`
  via `onChange={(checks) => onChange({...stage, checks})}`, passing the
  same `stageIndex`/`graph`/`inputs`/`roles`/`assets`/`iterating` values
  already computed for every other `BindingPicker` usage on this page.
- Chunk 6 (qc/retryLimit/approval/budget/model/enabledWhen/iterate) is
  explicitly untouched — `stage.checks` was the only field this chunk
  edited.
- No unit tests added — still no test runner configured for `apps/web`.
- Verification: `pnpm --filter @reefcraft/shared build` (clean, untouched),
  `pnpm --filter @reefcraft/web typecheck` (clean), `pnpm --filter
@reefcraft/web build` (clean, same pre-existing chunk-size warning),
  `pnpm lint` (0 errors, same 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), `pnpm format:check` (clean after `prettier
--write` on the one new file this chunk added) — all green.

### Chunk 6a

Chunk 6 was split into two passes per the plan's own risk callout (§Risk 1
and 5). This pass implements only `retryLimit`, `budget`, `model`,
`enabledWhen`. `qc`, `approval`, `iterate` are explicitly deferred to
Chunk 6b — not started, not touched.

- **Provider-discovery gap, confirmed and fixed** (plan's Risk 6): there
  was no way to list registered providers — `ProviderRegistry` had `get()`
  but no `list()`, and `GET /providers/:id/models` needs a provider id
  already in hand. Added `ProviderRegistry.list(): string[]`
  (`apps/api/src/provider/provider.registry.ts`, `[...this.adapters.keys()]`)
  and `GET providers` on `CapabilityController`
  (`apps/api/src/capability/capability.controller.ts`, alongside the
  existing `GET providers/:id/models`, returning `this.providers.list()`)
  — a pure wrap of existing registry data, no new logic, consistent with
  Locked Decision 7's spirit. Confirmed the five registered providers via
  `apps/api/src/provider/provider.module.ts`'s `onModuleInit`: `fake`,
  `openrouter`, `elevenlabs`, `fal`, `deepgram`.
- **`apps/web/src/api/client.ts`**: added `api.listProviders()` (`GET
/providers` → `string[]`) and `api.listModelsForProvider(providerId)`
  (`GET /providers/:id/models` → `ModelInfoDto[]`) — neither wrapper
  existed before this chunk; `ModelInfoDto` is `{providerId, modelId,
label, modality}`, unchanged from Phase 9, already exported from
  `@reefcraft/shared`.
- **New `apps/web/src/components/canvas/ModelPinEditor.tsx`** — the
  reusable model-pin picker the plan calls out Chunk 6b will need for
  `qc.model` (a full `ModelPin`, not the `PartialModelPin` `StageDef.model`
  is). Built as **one component, not two**, via a `clearable?: boolean`
  prop (default `true`):
  - Renders a provider `<select>` (`api.listProviders`), a model `<select>`
    scoped to the chosen provider (`api.listModelsForProvider`, disabled
    until a provider is picked), an optional `version` text input, and a
    free-form string-valued key/value list for `params` (`ModelInfo`/
    `ModelInfoDto.capabilities` isn't a `JsonSchema` — plan's Risk 5 — so
    `params` can't be driven through `SchemaForm`; this is the sanctioned
    simplification, not a shortcut).
  - `value: PartialModelPin | undefined`; every field the component itself
    ever emits back through `onChange` is a concrete value (provider/
    modelId as strings, possibly `''` if not yet chosen; `params` always an
    object, never `undefined`) — so a caller that needs the stricter
    `ModelPin` can pass `clearable={false}` (hides the "Unset model"
    button, so `onChange` is never called with `undefined`) and cast the
    non-`undefined` result directly, with no extra normalization needed.
    **This is the exact hook Chunk 6b's `qc.model` should use**:
    `<ModelPinEditor value={qc.model} onChange={(pin) => update({...qc,
model: pin as ModelPin})} clearable={false} />`, seeding `qc.model`
    with `{provider: '', modelId: '', params: {}}` when a `qc` block is
    first added (since `QcDef.model` is a required `ModelPin`, not
    optional).
- **`StageInspector.tsx`** — four new sections after "Checks":
  - **Retry limit**: a single number input on `stage.retryLimit`, `?? 0`
    as the displayed fallback (the field is non-optional on `StageDef`, so
    a real graph always has a value already; the fallback only covers an
    edge case, not runtime data).
  - **Budget**: new local `BudgetEditor` — two optional number inputs
    (`stageCapUsd`/`qcCapUsd`). Clearing semantics: an empty input string
    maps to `undefined` for that one field (`toNumberOrUndefined`, also
    guards against `NaN` from a stray non-numeric value), and once **both**
    fields are `undefined`, `onChange` is called with `undefined` for the
    whole `budget` object rather than `{}` — chosen after checking
    `apps/api/src/run-config/stage-def-layer.ts`, which only branches on
    each sub-field's own `!== undefined` check and never distinguishes
    `stage.budget` being `{}` vs `undefined` itself, so either is
    functionally safe there; `undefined` was picked anyway to mirror the
    field's own optionality (matches how `model`/`enabledWhen` clear too,
    and how the rest of `StageDef`'s optional fields already round-trip
    through this same inspector).
  - **Model**: `ModelPinEditor` bound to `stage.model` directly (default
    `clearable={true}`, so its "Unset model" button clears the whole field
    back to `undefined`).
  - **Enabled when**: new local `EnabledWhenEditor`. Reuses the `inputs:
InputDef[]` prop `StageInspector` already receives for `BindingPicker`
    (no new prop threading needed) — a `<select>` of `input.key`/
    `input.label` pairs plus a plain text `equals` input. Kept `equals` as
    a plain string for this pass rather than inferring/coercing to the
    input's declared type (explicitly a nice-to-have per the plan, not
    required); when `stage.enabledWhen` is unset, only a "+ add condition"
    button renders (seeds `{input: inputs[0]?.key ?? '', equals: ''}`); a
    "Remove condition" button clears it back to `undefined`.
- No unit tests added — still no test runner configured for `apps/web`.
  Backend change is a pure additive wrap with no branching logic, so no
  new `apps/api` unit test was added either; the full e2e suite (below)
  covers regression.
- Verification: `pnpm --filter @reefcraft/shared build` (clean, untouched),
  `pnpm --filter @reefcraft/api typecheck` (clean), `pnpm --filter
@reefcraft/api exec vitest run -c vitest.e2e.config.ts` (32 files, 178
  tests, all passing — zero regressions from the new `GET /providers`
  route), `pnpm --filter @reefcraft/web typecheck` (clean), `pnpm --filter
@reefcraft/web build` (clean, same pre-existing chunk-size warning),
  `pnpm lint` (0 errors, same 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), `pnpm format:check` (clean after `prettier
--write` on the files this chunk touched) — all green.
