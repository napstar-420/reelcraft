# PR Review: #20 — feat(canvas): Phase 9.5 — Visual Blueprint Canvas

**Reviewed**: 2026-09-21
**Author**: napstar-420 (Zohaib Khan)
**Branch**: `codex/phase9.5-visual-canvas` → `main`
**Decision**: APPROVE (with comments)

## Resolution

All 3 MEDIUM findings fixed in a follow-up commit. A shared `TypedValueInput` component (`apps/web/src/components/canvas/TypedValueInput.tsx`) — a type selector (string/number/boolean) plus the matching control — now backs all three sites: `EnabledWhenEditor`'s `equals` (`StageInspector.tsx`), `BindingPicker`'s `const` case, and `ModelPinEditor`'s `ParamsEditor`. Verified via typecheck/lint/format/build/unit+e2e tests (all green) and manual browser verification (added a stage, switched `enabled when`'s `equals` through all three types, confirmed a param row renders the same typed control). The 2 LOW notes are unchanged (informational, not actioned).

## Summary

A large (25 files, +4.8k/-5), well-organized PR that delivers the full no-code visual blueprint canvas per `docs/plans/phase-9.5-visual-canvas.md`: every `StageDef` field gets real form/picker UI, live server-validation is surfaced per-node/per-field, and the full save → dry-run loop works end to end. Backend additions are minimal, additive wrappers around existing service logic, consistent with the repo's established patterns (Nest DI, Drizzle, Zod DTO validation, `NotFoundException`/`ZodValidationPipe` conventions). All validation gates pass cleanly. The one systemic gap is that a handful of fields typed as `string | number | boolean` or `unknown` in the shared schema are only editable as plain strings in the generated UI, which silently produces the wrong runtime type for non-string values — a real (if narrow) hole in the PR's own "no-code, no exceptions" claim.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **`EnabledWhenEditor` can never author a non-string `equals` value** — `apps/web/src/components/canvas/StageInspector.tsx:228-235`. `EnabledWhen.equals` is typed `z.union([z.string(), z.number(), z.boolean()])` (`packages/shared/src/stage-def.ts:10`), but the editor is a plain `<input type="text">` that always writes back `e.target.value` (a string) and never coerces. A stage gated on a boolean or numeric input (e.g. `enabledWhen: {input: 'useSubtitles', equals: true}`) can only ever be saved as `equals: "true"`, which will never `===` the real boolean/number value at runtime — the condition silently always evaluates false (or always true, depending on which branch a downstream check assumes). `BlueprintValidatorService.checkEnabledWhenDeclaration` only checks that `input` names a declared key; it never checks `equals`'s type against the input's declared shape, so nothing catches this at save time either.
   - _Suggested fix_: look up the referenced input's `accepts.kind` and render a `<select>`/checkbox/number input accordingly (mirrors the existing `coerceEnumValue` pattern in `SchemaForm.tsx`).

2. **`BindingPicker`'s `const` case only supports string literals** — `apps/web/src/components/canvas/BindingPicker.tsx:208-214`. `Ref.const.value` is `z.unknown()` (`packages/shared/src/ref.ts:24`) — a legitimate const binding can be a number, boolean, array, or object (e.g. `iterate.over: {from:'const', value: [...]}` for a fixed iteration list, or a numeric literal bound to an integer config slot). The picker renders a single `<input type="text">` that blanks any non-string value and overwrites it with a plain string on the next keystroke, so no non-string const can be authored anywhere in the canvas — including `IterateEditor`'s own default `{from:'const', value: []}` (`StageInspector.tsx:487`), which can't be edited back into a real array once touched.
   - _Suggested fix_: at minimum, special-case boolean/number consts (checkbox / number input); a JSON-array/object const can reasonably stay out of scope for this phase if flagged as a follow-up.

3. **`ModelPinEditor`'s `ParamsEditor` stores every param as a string** — `apps/web/src/components/canvas/ModelPinEditor.tsx:26-28, 44-55`. `ModelPin.params` is `z.record(z.string(), z.unknown())` (`packages/shared/src/config-layer.ts:7`) — real provider params are frequently numeric (`temperature`, `max_tokens`, `cfg_scale`). `updateValue` always writes `e.target.value` (a string) with no coercion, so a saved blueprint sends `{max_tokens: "500"}` instead of `{max_tokens: 500}` to a real (non-fake) provider adapter. This is untested by this PR's suite since dry-run only exercises `FakeProviderAdapter`, which likely ignores params — so it would only surface against a real provider in production.
   - _Suggested fix_: same class of fix as #1/#2 — a lightweight type toggle (string/number/boolean) per param row, or attempt `JSON.parse`-with-fallback on blur.

### LOW

4. **`StageInspector.tsx` (919 lines) and `BlueprintCanvasPage.tsx` (616 lines) are large single files** covering many sub-editors/components. The code is well-decomposed internally (one function/component per concern) and the PR's own comments explicitly justify not extracting further (e.g. duplicating small `IssueList`/`nextFreeKey` helpers instead of adding cross-file exports) — a reasonable call for this phase, but both are now candidates for splitting into `components/canvas/inspector/*` if Phase 10 adds more fields here.
5. **No frontend unit tests for the new pure helpers** (`moveStage`, `memoryEdges`, `deriveMemoryWriters`, `parseValidationPath`) despite the plan's Locked Decision 8 calling for `parseValidationPath()` to be "unit-tested against every path shape." This matches a pre-existing repo constraint (no test runner configured for `apps/web`, confirmed in this PR's own Chunk 1/2 notes), not a regression introduced here, but it's worth tracking if `apps/web` ever gets a runner.

## Validation Results

| Check                             | Result                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| Type check (`shared`/`api`/`web`) | Pass                                                                  |
| Lint                              | Pass (1 pre-existing unrelated warning in `media-output.e2e.test.ts`) |
| Format check                      | Pass                                                                  |
| Unit tests (`api`)                | Pass — 42 files / 277 tests                                           |
| E2E tests (`api`)                 | Pass — 32 files / 178 tests, incl. 2 new files for this PR            |
| Build (`web`)                     | Pass (one pre-existing chunk-size warning, unrelated to this PR)      |

## Files Reviewed

- Modified: `apps/api/src/blueprint/blueprint.controller.ts`, `apps/api/src/blueprint/blueprint.service.ts`, `apps/api/src/capability/capability.controller.ts`, `apps/api/src/provider/provider.registry.ts`, `apps/web/src/App.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/pages/BlueprintsPage.tsx`, `apps/web/package.json`, `packages/shared/src/dto/blueprint.dto.ts`, `docs/build-progress.md`, `pnpm-lock.yaml`
- Added: `apps/api/test/e2e/blueprint-create.e2e.test.ts`, `apps/api/test/e2e/blueprint-get.e2e.test.ts`, `apps/web/src/components/canvas/{AddStageMenu,BindingPicker,BlueprintSettingsPanel,ChecksEditor,ModelPinEditor,SchemaForm,StageInspector}.tsx`, `apps/web/src/lib/{memory-writers,parse-validation-path}.ts`, `apps/web/src/pages/BlueprintCanvasPage.tsx`, `docs/plans/phase-9.5-visual-canvas.md`, `.claude/plans/phase-9.5-progress.md`
