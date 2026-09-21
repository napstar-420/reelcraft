# Phase 9.5 — Visual Blueprint Canvas: implementation progress

Plan: `docs/plans/phase-9.5-visual-canvas.md`
Branch: `codex/phase9.5-visual-canvas`

## Chunks

- [x] Chunk 1 — Backend baseline + canvas skeleton
- [x] Chunk 2 — Stage node CRUD (add / remove / reorder)
- [ ] Chunk 3 — Binding picker (the `Ref` editor)
- [ ] Chunk 4 — Inspector panel: capability config + slots/context
- [ ] Chunk 5 — Checks editor
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
