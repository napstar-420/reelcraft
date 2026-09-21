# Phase 9.5 — Visual Blueprint Canvas: implementation progress

Plan: `docs/plans/phase-9.5-visual-canvas.md`
Branch: `codex/phase9.5-visual-canvas`

## Chunks

- [x] Chunk 1 — Backend baseline + canvas skeleton
- [x] Chunk 2 — Stage node CRUD (add / remove / reorder)
- [x] Chunk 3 — Binding picker (the `Ref` editor)
- [x] Chunk 4 — Inspector panel: capability config + slots/context
- [x] Chunk 5 — Checks editor
- [x] Chunk 6 — Remaining StageDef fields (qc, retryLimit, approval, budget, model, enabledWhen, iterate)
- [x] Chunk 7 — Live validation overlay + memory-edge arcs
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

### Chunk 6b

Final pass of Chunk 6 — `qc`, `approval`, `iterate`, the three fields
deferred by 6a. With this, every `StageDef` field has form UI and Locked
Decision 3's no-code mandate holds with no gaps in the per-stage
inspector. All three sections live in `apps/web/src/components/canvas/StageInspector.tsx`,
added after "Enabled when", each following 6a's optional-block "+ add X" /
"Remove X" toggle pattern:

- **QC** (`QcEditor` + `QcDimensionsEditor`): `criteria` (text),
  `threshold` (number), `includeInputs` (checkbox), `media.includeTranscript`
  (checkbox — checked constructs `media: {includeTranscript: true}`,
  unchecked omits `media` entirely rather than storing `false`, mirroring
  `BudgetEditor`'s "omit the optional object rather than false-ify it"
  convention), `model` (the existing `ModelPinEditor` from 6a, with
  `clearable={false}` since `QcDef.model` is a full, required `ModelPin`;
  its `onChange` result is cast `as ModelPin` per that component's own
  doc comment — every field it emits is concrete when `clearable={false}`),
  and `dimensions` as a repeatable `{key, description, weight}` list
  (add/remove rows, mirroring `ChecksEditor`'s repeatable-list shape).
  Adding a fresh `qc` block seeds
  `{criteria: '', threshold: 0, model: {provider: '', modelId: '', params: {}},
includeInputs: false}` — `params: {}` is required in the seed because
  `ModelPin.params` (unlike `PartialModelPin.params`) is a non-optional
  `z.record`, so a bare `{provider, modelId}` doesn't typecheck as a full
  `ModelPin`.
- **Approval** (`ApprovalEditor`): `mode` as a `stage`/`item` `<select>`
  (spec said "radio" for `enabledWhen`'s sibling fields elsewhere in the
  plan text, but every other two-option field in this inspector, e.g.
  check `type`, already uses `<select>` — kept consistent with that,
  not a deviation from the actual `StageInspector.tsx` house style).
  `onReject` is its own nested optional sub-block with its own add/remove
  toggle; when present, `retryStageKey` is a plain `<select>` over
  `graph.map(s => s.key)` — not a `BindingPicker`, since it names a stage
  identity, not a `Ref`. No extra validation beyond offering the list (a
  stage retrying itself is valid and is the documented default when
  `onReject` is entirely absent).
- **Iterate** (`IterateEditor`): `over` via `BindingPicker` with
  `iterating={false}` **always** — including when this same stage already
  declares `iterate` — because `iterate.over` resolves the source array
  _before_ any item of this stage's own iteration exists, so `item`/
  `prevItem` referencing this stage would be circular as a source for its
  own `over`. Every other `BindingPicker`/`ChecksEditor` usage in this
  file is untouched and still passes `iterating={!!stage.iterate}`.
  `itemAlias` is a plain text input. `alignWith` is a checkbox toggling
  the literal `'item'` vs `undefined`, rendered unconditionally (the plan
  doc's Chunk 6 section suggested gating this on "previous stage also
  iterates," but the validator (`blueprint-validator.service.ts`) already
  enforces that precondition server-side with a real error message, and
  the task spec for this pass asked only for the plain on/off toggle —
  so no client-side gating was added here, consistent with this file's
  general pattern of leaving cross-field validation to
  `POST /blueprints/:id/validate`). `itemRetryLimit` is a number input;
  `maxItems` is an optional number input clearing to `undefined` on an
  empty string, mirroring `BudgetEditor`'s `toNumberOrUndefined` pattern.
  Adding a fresh `iterate` block seeds
  `{over: {from: 'const', value: []}, itemAlias: 'item', itemRetryLimit: 0}`.
  **`groupKey` was deliberately left untouched — no UI was added for it
  anywhere.** It remains reserved/unimplemented per its own doc comment
  in `packages/shared/src/stage-def.ts` ("Reserved for a future phase —
  not implemented; the engine and validator never read it"); nothing in
  this pass sets, reads, or renders it.
- A minor TypeScript wrinkle worth flagging for future editors of this
  file: a `set(patch: Partial<T>)` helper that spreads `{...current,
...patch}` back into a fully-required type (`QcDef`, `StageDef['iterate']`,
  and the new `QcDimensionsEditor` row type all have required, not
  optional, fields) needs an explicit `as T` cast on the merged result —
  TypeScript's object-spread inference otherwise widens the merged
  object's properties to optional wherever the second spread operand
  (`Partial<T>`) could omit them, even though every call site only ever
  passes concrete values for the fields it's actually changing. This
  differs from `BudgetEditor`'s pre-existing `set` helper, which never
  needed a cast because `StageDef['budget']`'s own fields are already
  optional.
- No unit tests added — still no test runner configured for `apps/web`;
  consistent with every prior chunk's precedent.
- Verification: `pnpm --filter @reefcraft/shared build` (clean,
  untouched), `pnpm --filter @reefcraft/web typecheck` (clean after
  adding the three `as T` casts described above), `pnpm --filter
@reefcraft/web build` (clean, same pre-existing chunk-size warning),
  `pnpm lint` (0 errors, same 1 pre-existing unrelated warning in
  `media-output.e2e.test.ts`), `pnpm format:check` (clean after `prettier
--write` on `StageInspector.tsx`, the only file this chunk touched) —
  all green.

### Chunk 7a — validation wiring + memory-edge arcs

Chunk 7 is split into two passes; this is 7a: `parseValidationPath()`, the
debounced `POST /blueprints/:id/validate` call, a graph/node-level overlay,
and the memory-edge arcs. Per-field inline highlighting inside
`StageInspector` is explicitly deferred to 7b — `StageInspector.tsx`'s
internals are untouched beyond accepting a new, currently-unused `issues`
prop (see below).

- **`parseValidationPath()`** (new, `apps/web/src/lib/parse-validation-path.ts`)
  returns `{stageKey?, region?, name?, raw}` — `raw` is always the original
  path string, unconditionally. For 7b's implementer:
  - A path not starting with `stages.` (`memory.<key>`, `roles.<key>`, bare
    `graph`/`roles`) returns just `{raw: path}` — no `stageKey`.
  - A bare `stages.<key>` returns `{stageKey, region: 'stage', raw}`.
  - `stages.<key>.slots|context|config|output|approval|model|iterate|
enabledWhen|instructions.<rest>` returns `{stageKey, region, name: rest,
raw}` where `rest` is everything after the region segment, dot-joined
    (so a nested Ajv `config` violation like `config.bar.baz` yields
    `name: 'bar.baz'`, not just `'bar'`). When there's no `rest` (shouldn't
    normally happen for these regions, but defends against it),
    `name` is omitted entirely rather than set to `undefined` —
    `exactOptionalPropertyTypes` is on in this repo's `tsconfig.base.json`,
    so `{name: undefined}` doesn't typecheck as omission.
  - `stages.<key>.capability` and `stages.<key>.qc` return `{stageKey,
region, raw}` with no `name` (they're scalar fields, not named
    collection members).
  - `stages.<key>.checks[<i>].<rest>` (bracket index is part of the same
    dot-segment as `checks`, e.g. `checks[0]`, matched with a small regex)
    returns `{stageKey, region: 'checks', name, raw}` where `name` is
    `"<index>"` alone when the path ends at the check itself, or
    `"<index>.<rest>"` (e.g. `"0.refs.foo"`, `"2.params.bar"`) when there's
    a sub-field — split on the first `.` to recover the index as a string.
  - **One shape the "exhaustive" list in the plan doesn't call out**:
    `checkFirstStagePrev` (the "`{from:'prev'}` invalid on first stage"
    error) emits `stages.<key>.<name>` directly — `name` being the slot or
    context field name itself, with **no** `slots`/`context` segment in
    between (confirmed by reading the emit site directly, not assumed).
    This doesn't match any recognized region keyword, so it falls into the
    parser's default case: `{stageKey, name: '<name>', raw}` with `region`
    left `undefined`. 7b can't tell from this alone whether `<name>` is a
    slot or a context key — if that distinction matters, 7b will need to
    cross-reference the stage's own `slots`/`context` objects.
  - Any other unrecognized shape under `stages.<key>.*` also falls back to
    this same default case (`{stageKey, name: <everything after the
stage key>, raw}`) rather than throwing.
- **Debounce**: `EditBlueprintCanvas` gained a second `useEffect`/`useRef`
  pair mirroring `StageInspector`'s Chunk 4 `resolveTimer` idiom exactly —
  `window.setTimeout`/`window.clearTimeout` on a `useRef<number>`, gated on
  a `JSON.stringify(draft)` content key (not `draft`'s object identity),
  450ms delay. Calls `api.validateBlueprint(blueprintId, draft)`; on
  success stores `{issues, runnable}` in state and clears a `validationFailed`
  flag; on rejection (network error, etc.) sets `validationFailed` instead
  of touching the previous `validation` result, so a transient failure
  doesn't wipe out the last-known-good overlay. `validation` starts `null`
  and stays `null` until the first successful round-trip.
- **Overlay**: `groupIssuesByStage()` and `graphLevelIssues()` (both pure,
  in `BlueprintCanvasPage.tsx`, built on `parseValidationPath()`) split
  `validation.issues` into per-stage buckets vs. the ones with no
  `stageKey`. Per-stage counts render as a plain `✗ <n> ⚠ <n>` string next
  to each stage's `<li>` in the existing delete-button list. Graph-level
  issues render as a `<ul>` banner above the canvas. A top-level `<p>`
  shows `✓ Runnable` / `✗ Not runnable yet` once a `validation` result
  exists, or a "couldn't validate" note when the last request failed —
  no icon library, plain text/unicode glyphs only, matching this file's
  existing convention (no UI kit anywhere in this phase).
- **`StageInspector` hand-off**: gained an optional `issues?: ValidationIssue[]`
  prop, passed from `BlueprintCanvasPage` as `issuesByStage.get(selectedStageKey) ?? []`.
  Destructured as `issues: _issues` (renamed, unused) so it doesn't trip
  `@typescript-eslint/no-unused-vars`'s `argsIgnorePattern: '^_'` while
  keeping the external prop name `issues` for 7b to just start reading.
  Nothing else in `StageInspector.tsx` was touched.
- **`memory-writers.ts`**: added `deriveMemoryWriters(graph): Map<string,
string[]>` (memory key → stage keys that declare `writes[key]`, in graph
  order, duplicates preserved per-key never deduped since a key legitimately
  written by two stages is exactly the "ambiguous" case the arcs need to
  show). `deriveMemoryKeys()` is now `[...deriveMemoryWriters(graph).keys()]`
  — no second scan of `stage.writes` anywhere in the codebase.
- **Memory-edge arcs**: new `memoryKeysReadByStage()` and `memoryEdges()` in
  `BlueprintCanvasPage.tsx` (not `memory-writers.ts` — this half is
  reader-side and edge-shaped, judged to belong with the other edge
  computation, i.e. next to `prevEdges()`). `memoryKeysReadByStage()` scans
  a stage's `slots`, `context`, `iterate.over`, and every script check's
  `refs` for `{from:'memory'}` — the same `Ref` shape appears uniformly in
  all four, so one small helper covers them. `memoryEdges()` joins that
  against `deriveMemoryWriters()`: one `@xyflow/react` `Edge` per
  (writer, reader) pair, `id: 'mem:<key>:<writer>-><reader>'`, `type:
'default'`, `animated: true`, `label: <memoryKey>`, and `style.stroke`
  `'#7c3aed'` (purple) for a single-writer key or `'#dc2626'` (red,
  matching the error/warning red used elsewhere) for a key with more than
  one writer — every writer still gets its own edge, none suppressed or
  merged, per Locked Decision 6. A stage reading a key it also writes
  itself is skipped (no self-loop edge) — not spec'd either way, judged
  safer than a degenerate self-pointing arc. `StageGraphCanvas`'s edges
  are now `[...prevEdges(graph), ...memoryEdges(graph)]`; `prev` edges are
  visually unchanged (default styling, no color/dash), so the two edge
  kinds are easy to tell apart at a glance.
- No unit tests added for `parseValidationPath()`/`memory-writers.ts` —
  still no test runner configured for `apps/web`, consistent with every
  prior chunk's precedent; the plan's own "Tests and exit criteria" section
  for Chunk 7 assumed one would exist by now, but it doesn't yet.
- Verification: `pnpm --filter @reefcraft/shared build` (clean, untouched),
  `pnpm --filter @reefcraft/web typecheck` (clean — needed two small fixes
  for this repo's `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`
  settings: omit `name` entirely rather than assign it `undefined`, and
  default the regex capture group to `''` since `noUncheckedIndexedAccess`
  types it as possibly-`undefined`), `pnpm --filter @reefcraft/web build`
  (clean, same pre-existing chunk-size warning), `pnpm lint` (0 errors,
  same 1 pre-existing unrelated warning in `media-output.e2e.test.ts`),
  `pnpm format:check` (clean after `prettier --write` on the two files
  this chunk's first draft left unformatted) — all green.

### Chunk 7b — per-field inline validation messages

Final pass of Chunk 7. Consumes the `issues` prop `StageInspector` already
received (unused) from 7a, rendering each issue inline next to the field
`parseValidationPath()` says it's about. `BlueprintCanvasPage.tsx`'s
grouping/badge/banner logic and the memory-edge arcs (both 7a) were not
touched — `issuesByStage.get(selectedStageKey) ?? []` was already being
passed into `StageInspector` before this pass started.

- **New local `IssueList` component**, duplicated verbatim (not extracted
  to a shared file) in both `StageInspector.tsx` and `ChecksEditor.tsx` —
  a 10-line `<ul>` of `"ERROR: <message>"` / `"WARNING: <message>"` `<li>`s,
  no color/icon library, matching the task spec's explicit "plain text
  prefix is fine" instruction over the original plan doc's red/yellow
  badge language. Duplicated rather than shared because the two files have
  no existing shared-component module to put it in and a 10-line function
  didn't justify creating one.
- **Matching issues to fields** (`StageInspector.tsx`): one `parsedIssues =
  issues.map(issue => ({issue, parsed: parseValidationPath(issue.path)}))`
  computed once per render, filtered per section via a local `issuesFor(predicate)`
  helper:
  - `region: 'capability'` → under the Capability `<select>`.
  - `region: 'config'` → one flat list under the whole `SchemaForm` (no
    per-nested-property attribution, per the task spec).
  - `region: 'slots'`, `name` matching a resolved slot's `name` → under
    that slot's `BindingPicker` row.
  - `region: 'context'`, `name` matching a context key → under that
    context row.
  - `region: 'output'`: `name === 'kind'` → under the kind `<select>`;
    `name === 'schema'` → under the `SchemaForm`; `name === undefined` →
    under the section heading generally.
  - `region: 'model'` / `'enabledWhen'` / `'qc'` / `'approval'` /
    `'iterate'` → one flat list under each section's editor, matched 1:1
    on `region` alone (none of these regions carry a `name` this pass
    needs to sub-attribute against, per the task spec).
  - `region: 'checks'`: `name` split into `"<index>[.<rest>]"` — matched
    by `p.name === String(index) || p.name?.startsWith(\`${index}.\`)` —
    and handed to `ChecksEditor` pre-bucketed by index (see below), not
    sub-attributed further to `key`/`code`/`params`/`refs.<name>` within a
    check, per the task spec.
  - `region: undefined` (the `checkFirstStagePrev` fallback — a bare name
    with no region prefix): if `name` matches one of this stage's resolved
    slot names or its own `context` keys, it's treated exactly like a
    `slots`/`context` issue and attached to that row; otherwise it falls
    through to the top-level banner alongside `region: 'stage'` issues.
    `resolved.slots` (from the existing capability-resolve `useState`) and
    `Object.keys(stage.context)` are the two lookups used to make that
    call — no new resolve call added.
  - `region: 'stage'` (whole-stage issues, e.g. "neither checks nor qc",
    duplicate-key warnings) → a top-of-inspector `<IssueList>`, above
    "Key"/"Label", combined with the unmatched-fallback case above into
    one `stageLevelIssues` list.
  - Memory writes / Retry limit / Budget sections get no `<IssueList>` —
    confirmed against 7a's exhaustive path enumeration that no validator
    path shape maps to them.
- **`ChecksEditor.tsx` prop addition**: `issues?: ValidationIssue[][]`
  added to `ChecksEditorProps`, indexed by check position — `StageInspector`
  builds this as `stage.checks.map((_, i) => issuesFor(...))` and passes it
  straight through. Inside `ChecksEditor`, one `<IssueList issues={issues?.[index]
??  []} />` renders per check `<fieldset>`, right after `CheckTestPanel` and
  before the "Remove check" button — all of that check's issues shown
  together under its row, not sub-attributed to the exact `key`/`code`/
  `params`/`refs.<name>` field within it, per the task spec. This is the
  only prop-shape change made outside `StageInspector.tsx`.
- No unit tests added — still no test runner configured for `apps/web`,
  consistent with every prior chunk's precedent.
- Verification: `pnpm --filter @reefcraft/shared build` (clean, untouched),
  `pnpm --filter @reefcraft/web typecheck` (one fix needed: `p.name === String(index)
|| p.name?.startsWith(...)` inferred as `boolean | undefined` rather than
  `boolean` because `p.name` is optional — wrapped the `startsWith` call in
  `!!` to force a boolean), `pnpm --filter @reefcraft/web build` (clean,
  same pre-existing chunk-size warning), `pnpm lint` (0 errors, same 1
  pre-existing unrelated warning in `media-output.e2e.test.ts`), `pnpm
format:check` (clean after `prettier --write` on the two files this
  chunk touched) — all green.
