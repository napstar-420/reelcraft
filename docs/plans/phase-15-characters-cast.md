# Phase 15 — Multi-character shots and run-generated characters

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F4).
Baseline: `main` at `4a1e381`. Builds on Phase 8 (characters). Independent of
Phases 11–14, but adds a Ref variant (`cast`) and widens `RoleDef`, so it
conflicts mechanically with other Ref/validator-context changes; rebase order is
in the master plan.
Scope: (a) N roles per blueprint and multi-identity image/video stages;
(b) characters a **run designs for itself**, usable like channel Characters and
promotable afterwards.

## Decisions at a glance

| #   | Decision                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Multi-character shots use the **existing `references` slot**, fed by one new Ref variant `{from:'cast'}`. No new `subject` slot, no compositing in v1.                                                                                                                                               | Every provider that takes references already accepts N ordered images; the slot exists on `image.generate` and `video.generate` (`media-generate.capability.ts:147-149`, `:249-255`). Compositing needs a capability that doesn't exist. |
| D2  | **No automatic reference-budget degradation.** The user's per-role selection is kept; the **sum** across all identities a stage receives is checked against `maxRefs` (save error, start error, runtime fail-before-spend for dynamic casts). The only degradation is user-chosen: `take:'primary'`. | Matches "reject, never truncate" (`run.service.ts:460-462`) and the project rule against silent caps; automatic equal split is the silent degradation spec §18.5 warns about and breaks reproducibility.                                 |
| D3  | A run-generated character is a **run role**: a `RoleDef` whose identity is read from **Run Memory** keys written by earlier stages. Not a new table, not a `character` row.                                                                                                                          | Invalidation, seeding, tombstones, provenance and GC come free from Run Memory and artifacts. Promotion reuses the existing copy-to-`characters/` path.                                                                                  |
| D4  | **Roles as typed inputs (§18.6): not now.** `RoleDef.source` (`channel` \| `run` \| `launch`) makes a later fold into `InputDef` mechanical.                                                                                                                                                         | Unifying now churns run launch, packages, seed-diff and validator without user-visible gain.                                                                                                                                             |

## Current state

**Data model and DTOs**

- `character` table `apps/api/src/db/schema/character.ts:9-23` (scope `channel|blueprint`, readiness `draft|ready`, soft-deleted).
- `ReferenceImage`/`ReferencePolicy` `packages/shared/src/character.ts:4-19`. `ReferencePolicy` is unused; phase 8 replaced spec §18.1's automatic fill with **explicit `referenceBlobIds`** (`docs/plans/phase-8-characters.md`).
- `RoleDef { key,label,required,characterId?,referenceBlobIds? }` `dto/blueprint.dto.ts:14-23`; the one-role cap is enforced twice: Zod `.max(1)` at `:49` and `checkRoleCount` (`blueprint-validator.service.ts:109-118`).
- `CreateRunDto.roleBindings` (`dto/run.dto.ts:51`) is stored at create (`run.service.ts:255`) then **overwritten** by the blueprint-derived snapshot in `start()` (`:350-368`): "choose a character per run" is half-wired and currently ignored.

**Run start and snapshot**

- `resolveRoleBindings` (`run.service.ts:385-458`) loops over **all** roles (N already works); snapshots `{characterId,name,description,references[{blobId,sourceKey,mime,view,caption,probe}]}` primary first; a `required:false` role with no character still throws (`:390`) — `RoleDef.required` has no effect.
- `assertReferenceLimits` (`:463-502`) checks **per role** (`:494-499`), not the sum per stage.

**Binding**

- Resolver `case 'role'` `binding-resolver.service.ts:314-334`; values `{handle:'character:<id>:<blobId>', sourceKey, characterName, characterDescription, view, caption}`; provenance stores **blob ids in `artifactIds`** (`:332`) — mislabelled but harmless (closure reads only `read.artifactId`, `invalidation-closure.ts:172`).
- `StageDef.slots: Record<string, Ref>` (`stage-def.ts:25`) allows one Ref per slot: two roles can't feed one `references` slot; `coalesce` picks only the first defined value (`ref.ts:15-19`).
- Media providers read only `slots` (`media-generate.capability.ts:104-117`); `attach`/context files reach text stages only (`stage-runner.service.ts:578, 622, 636`).

**Prompt identity**

- `ProviderMediaCapability.prepare` (`:55-73`) adds de-duplicated `Character identity: <description>` lines, without names and without mapping images to characters: with two characters the model can't tell which image is which. Flow already labels ingredients by `characterName` (`flow-video.capability.ts:287-294`); text stages get `Name:`/`Description:` via `describeRole` (`common/file-inputs.ts:80-81`).

**Reference limits**

- `stageReferenceLimit` `common/reference-limit.ts:8-14`; per-model: fake image 4 (`fake-provider.adapter.ts:136`), ChatGPT 5 (`chatgpt-provider.adapter.ts:51`), Codex 5 (`codex-provider.adapter.ts:107`), fal 4 (`fal.adapter.ts:29`), Flow 20 (`flow-video.prompt.ts:7`).
- Save-time `validateReferenceLimits` `blueprint.service.ts:740-817` is per role (`:806-813`); a total check exists only for text attachments (`:721-732`).
- **Gap:** `roleRefsOf` (`blueprint/collect-asset-refs.ts:39-48`) inspects only top-level refs; a role inside a `coalesce` is allowed by the validator (`flattenCoalesce`, `blueprint-validator.service.ts:557`) but escapes both limit checks.

**Validator, QC, promotion, packages, UI**

- Role slot/context placement `blueprint-validator.service.ts:549-595` (roles only in many-cardinality `media.image` slots or attached text context); unbound roles `:941-958`.
- QC envelope sees inputs only as JSON (`qc/qc-envelope.ts:76-81`); an identity-consistency judge **cannot see the references today**.
- Promotion `CharacterService.promoteReference` `channel/character.service.ts:217-270` (copies an active run `media.image` artifact into `characters/` as a `scope='character'` blob with `sourceArtifactId`), exposed at `POST characters/:id/references/promote` (`character.controller.ts:73`); **no web UI calls it**.
- Run Memory constraints: an `image_list` output can't iterate or write memory (`media-generate.capability.ts:164-178`); seeding copies memory of reused stages (`run-seed.ts:318-321`); any `RoleDef` change stops seeding at stage 0 (`:103-105`).
- Packages assume a single role (`package-export.service.ts:237`, `:305`); web `RoleEditor` is hard-wired to `roles[0]` with "x of 1" (`BlueprintSettingsPanel.tsx:331-350, 513`); user guide "A blueprint can have one role" (`apps/docs/docs/channels/characters.md:61`); assistant guide "roles: at most ONE" (`guide.ts:159`, limits `:359`). `guide.test.ts` fails CI when a Ref kind is missing from the guide.

## Part (a) — multi-character shots

### Answers to the §18.6 questions

1. **Slot shape:** keep `references` (many, `media.image`); no `subject` slot (it would duplicate `references` semantics; current models condition on several identities in one call — ChatGPT/Codex image, fal, Flow "ingredients"; sequential single-character stages + compositing needs a new `image.composite`/`image.edit` capability whose seams and lighting mismatch are a quality problem of their own — compositing stays a possible later capability, not the fallback).
2. **Budget degradation:** explicit and validated, never automatic. Each role keeps its user-selected ordered subset (`referenceBlobIds`, primary first); a binding may say `take:'primary'` (the crowd-shot knob). The engine sums what a stage receives; over `maxRefs` -> save error, start error, or runtime fail-before-reserve for dynamic casts. Equal split rejected (silently changes which views a model sees whenever the cast changes); primary-only is a user choice, never applied by the engine on its own.

### Shared schemas

`ref.ts` — one new variant:

```ts
| { from: 'cast'; roleKeys: string[]; pick?: Ref; take?: 'selected' | 'primary' }
```

`roleKeys` = candidate identities in order (for a run **cast group** each member is a candidate); `pick` optional, must resolve to `string[]` of role/member keys (typically `{from:'item', path:'characters'}`), output follows `pick` order, absent = all; `take` `selected` (default) sends the role's whole selection, `primary` only the first reference. Resolved value = concatenation of each identity's role value (same object shape as today's `role` case) so `collectSourceKeys` (`provider/source-keys.ts`) and `collectFileInputs` work unchanged. `{from:'role', roleKey}` stays as the single-identity form.

`dto/blueprint.dto.ts` — `RoleDef` extended backward-compatibly (stored jsonb still parses):

```ts
RoleDef = z.object({
  key,
  label,
  required,
  source: z.enum(['channel', 'run', 'launch']).default('channel'),
  characterId: z.string().optional(), // channel
  referenceBlobIds: z.array(z.string()).optional(), // channel
  run: z
    .object({
      // run (part b)
      sheetKey: z.string(), // memory key: {key?,name,description} or an array of them
      referenceKeys: z.array(z.string()).min(1), // memory keys of media.image writes; first = primary
      members: z.enum(['one', 'many']).default('one'),
    })
    .optional(),
});
roles: z.array(RoleDef).default([]); // drop .max(1)
```

`source:'launch'` = "pick a channel Character when the run is launched", using the vestigial `CreateRunDto.roleBindings`; gives the "different character per run" request a no-generation reading; one small step (F4-8), droppable (Q3). `qc.ts`: `QcDef.compareReferences?: boolean` — the judge also receives the stage's resolved role/cast reference images.

### Snapshot (`run.role_bindings`)

Stays `Record<roleKey, RoleBinding>`, no migration (spec §18.5 promised this). `resolveRoleBindings` branches on `source`: `channel` as today; `launch` reads `run.roleBindings[key]` and applies the same readiness checks; `run` has no start-time snapshot. `required:false` with no character: **skip instead of throw** (fixes `:390`); validator rule: a stage binding an optional role must use `{from:'cast'}` (drops absent identities) or a slot with `required:false`.

### Resolver

- New `case 'cast'`: resolve `pick`; map keys to identities. An unknown key is an attempt failure before submit, classed `provider_error`-like with a clear message (no spend) — **not** `check_failed` (regenerating the consumer can't fix the planner's bad key). Apply `take`, concatenate, provenance `{ ref, parts: RefProvenance[] }`.
- Add `parts?: RefProvenance[]` to `RefProvenance` (`binding-resolver.service.ts:61-76`); teach `invalidation-closure.ts` (~`:165-210`) to recurse into `parts` (without this a cast over run roles would not invalidate when the character stage is retried). Fix the role provenance mislabel: `referenceBlobIds: [...]`, not `artifactIds` (`:332`).

### Budget enforcement (one helper at save, start, runtime)

1. Extract `stageIdentityRefCount(stage, roles, pickBound?)` next to `roleRefsOf`; make `roleRefsOf` see through `coalesce`. Per identity `take==='primary' ? 1 : selectedCount` (channel roles: `referenceBlobIds.length`; launch roles unknown until launch — start-time only; run roles `referenceKeys.length`, static).
2. Save (`blueprint.service.ts:740-817`): replace the per-role comparison at `:806` with the **sum per stage**. With `pick` and bounded `maxItems`: worst case = sum of the `maxItems` largest identities; unbounded: a warning ("cast size can't be checked before the run; a shot whose cast exceeds N references will fail before spending").
3. Start (`run.service.ts:463-502`): same sum over resolved snapshots (covers launch roles).
4. Runtime: in `StageRunnerService.reserveAndSubmit`, after `resolveBindings` (`stage-runner.service.ts:614`) and **before reservation**, count `sourceKey`s in role/cast-derived slot values; if over the limit fail the attempt: "shot 4 casts Mara (3) + Theo (3) = 6 references; model X accepts 5. Set 'Send' to primary-only, deselect references, or pick a model with more". This enforces the provider's own declared limit (as `loadReferenceFiles` does, `provider/reference-files.ts:27-30`), not an engine cap.

### Prompt identity labelling

Rewrite `ProviderMediaCapability.prepare` (`:55-73`) to walk slot values **in send order** and emit e.g. `Reference images 1–2: Mara (front, profile). Mara: <description>` / `Reference image 3: Theo (front). Theo: <description>`. Index numbering must match `collectSourceKeys` order (one helper, unit-tested against it). For a single role the output stays **byte-identical** to today (`Character identity: …`) so existing blueprints' prompts and seeds don't change.

### Validator

Remove `checkRoleCount` (`:109-118`). Extend `checkRoleSlotBindings` (`:549-595`) so `cast` is treated like `role` (many-cardinality `media.image` slot, or attached text context); `cast.roleKeys` must be declared roles. `checkUnboundRoles` (`:941`) counts `cast.roleKeys` as bound. If `pick` has a schema with `items.enum`, those values must be a subset of declared keys (error); a static unbounded set is a warning. `ValidationContext` (`validation-context.ts:41-51`) gets `rolesByKey: Map<string, RoleDef>`.

### QC: `qc.compareReferences`

In `StageRunnerService` (QC envelope build, ~`stage-runner.service.ts:1905-1920`), when set, collect role/cast references from `bindings.slots` into a new `QcEnvelope.references?: QcClip[]` (copied explicitly per field). Labels `"<name> — reference <n>"`. Judge limit via `judgeImagesProblem(count = outputs + references)`. Image outputs only; for video, Phase 13's framesheet `includeInputFrames`/approval UI shows references beside the clip.

## Part (b) — per-run generated characters

### Shape

A **run role** (`source:'run'`) names Run Memory keys: `sheetKey` = a `data` write whose schema has string `name` and `description` (for `members:'many'`, an **array** of `{key, name, description}` with string `key`); `referenceKeys` = ordered keys written by `media.image` stages, first resolved image is primary (`members:'one'`: scalar write or indexed group whose base read returns a list; `members:'many'`: each key is an **indexed group aligned to the sheet array**, member _i_ gets `key#i`, as produced by an `image.generate` stage iterating `over: {from:'memory', key: sheetKey}`).

### Recommended recipe (single hero), existing capabilities

1. `design_hero` (`text.generate`, data `{name, description, look:{…}}`, QC on distinctiveness): `writes: {heroSheet: '$'}`.
2. `hero_sheet_image` (`image.generate`, prompt asks for a **turnaround sheet**: front, ¾, profile in one image; `count: 3` with QC pick-best; approval): `writes: {heroRef: '$'}`. One image carries several views — saves budget, matters under 4–5 reference limits.
3. Optional `hero_views` iterating over a views list, `references: {from:'memory', key:'heroRef'}`, `qc.compareReferences: true`: `writes: {heroViews: '$'}`.
4. Role `{key:'hero', source:'run', run:{sheetKey:'heroSheet', referenceKeys:['heroRef','heroViews']}}`; later stages bind `{from:'role', roleKey:'hero'}` or a cast.

**Generated cast:** `design_cast` writes `castSheet` (array with `key`); `cast_refs` iterates over `castSheet`, writes `castRef` (`castRef#i`); role `{key:'cast', source:'run', run:{sheetKey:'castSheet', referenceKeys:['castRef'], members:'many'}}`. Shot stages use `{from:'cast', roleKeys:['cast','host'], pick:{from:'item', path:'characters'}}`, mixing generated members with a channel host. The recipe adds a **script check on the shot planner** validating `characters[]` against `castSheet` keys (script checks accept `refs`), so a bad key regenerates the planner, not the consumer.

### Resolver

`case 'role'` (and `cast` member lookup) for `source:'run'` resolves `sheetKey`/`referenceKeys` via `fetchMemoryRows` (`binding-resolver.service.ts:660-700`), building the same value shape as a channel role: `handle: 'artifact:<id>'` (canonical, §6.6), `sourceKey` from the artifact's blob, `characterName`/`characterDescription` from the sheet. Provenance = `parts[]` with one memory provenance per key read (`memoryKey`/`memoryVersion(s)`) — **§15.2 invalidation works unchanged**: retrying `design_hero` tombstones `heroSheet`, `hero_sheet_image` is invalidated as a reader, and so is every consumer of the role. `BindingScope` (`:37-59`) gets `roleDefs`.

### Readiness equivalence (§18.3)

|         | Channel / launch role                                         | Run role                                                                                                                                                                |
| ------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked | `RunService.start`, before any spend                          | Save time (structure) and first bind (content)                                                                                                                          |
| "Ready" | ≥1 non-deleted reference, Character not deleted, same channel | Every `referenceKeys` writer is an earlier `media.image` stage; `sheetKey` writer earlier with name/description strings in its schema; at bind ≥1 active image resolves |
| Failure | 409 at start                                                  | Save error; runtime "resolved to nothing" unreachable by ordering (signals a bug)                                                                                       |

Validator rules: every stage binding the role comes after **all** writers of its keys (with Phase 11, "after" means dependency-ordered, not merely later in the array); if any writer has a condition/`enabledWhen`, the consumer carries the same one (existing rule `blueprint-validator.service.ts:674-740`); warning when the character stages have neither QC nor approval ("a generated identity anchors every later shot; review it"). Budget at save uses `referenceKeys.length` per identity (`members:'many'`: per member) — static.

### Seeding, invalidation, re-rolls

- **Seed reuse = same character**: `copyReusedStages` copies run memory of reused stages (`run-seed.ts:318-321`), so "run again from stage 5" keeps the generated hero.
- **Re-roll:** `rerunStageKeys: ['design_hero']` regenerates it; everything that read it is downstream by recorded reads, so the seed prefix stops there.
- **Retry inside a run:** standard §15.5; cost preview lists every shot that would be redone (the right warning).
- Editing a `RoleDef` still stops the seed at stage 0 (`run-seed.ts:103`); correct for run roles too.

### Promotion to a channel Character

`POST /runs/:runId/roles/:roleKey/promote` with `{memberKey?, name?, views?: Record<artifactId, ReferenceImage['view']>}` -> `CharacterDto`. `CharacterService.promoteRunRole`: resolve the role's **current** values from run memory; create a `scope:'channel'` Character (name/description from the sheet); for each image reuse the copy logic of `promoteReference` (`character.service.ts:217-270`) extracted into a private `copyArtifactIntoCharacter(tx, target, artifactId, view, caption)`; primary = first image; `origin:'generated'` and `sourceArtifactId` keep provenance. Allowed in any run state where the artifacts are active (promotion copies). With Phase 14 present, an "also seed memory" toggle writes `character.<newId>.profile` (sheet JSON) as a committed `channel_memory` entry authored by the user.

### Roles as typed inputs (§18.6)

Deferred; the gap is narrowed: `source` is the discriminator a future `InputDef.accepts:{kind:'character'}` would carry; `launch` is exactly "role as run input"; folding = move `launch` roles into `inputs`, keep `channel`/`run` blueprint-bound. Doing it now forces package-format, seed-diff and run-launch rewrites for no new capability. Non-person identities (product, location) already work: a "Character" named _Kitchen set_ with references is just a role.

## Web, assistant, docs, spec, packages

**Web** (types only from shared): `BlueprintSettingsPanel` "Role" -> **Roles** list (no "of 1", `:513`), each with **Source**: _Channel character_ / _Choose when starting a run_ / _Made during the run_ (the last shows memory-key pickers for **Character sheet** and **Reference images** + **One character / A cast**). `BindingPicker` `references` slot gets a **Cast** source (multi-select roles, optional **Pick per item from**, **Send**: _Selected images_ / _Primary only_) with a live "uses up to N of M references" line (counting helper ported to `apps/web/src/lib/`). QC editor: **Compare with character references**. `RunLaunchDialog`: a character picker per `launch` role. Run page: **Cast** panel (each run role's sheet and images) with **Promote to channel character** (name prefilled, view per image, optional "Save profile to channel memory"); approval cards for image/video stages that use roles show the reference strip.

**Assistant:** `guide.ts` `inputs-roles` (`:155-160`) moves to N roles with the three sources, `cast`/`pick`/`take`, the budget sum, `compareReferences`; `refs` section (`:61-64`) gains `cast`; limits (`:359`) drop "More than one role" and add "creating channel Characters (promotion is a user action)". New recipe "Story with a generated cast" validated by `guide.test.ts`. `get_run` includes run-role values (names + artifact ids).

**User guide (stable slugs):** `channels/characters.md` (remove `:61`; role sources, characters made during a run, promotion); `blueprints/connecting-stages.md` (Cast binding); `blueprints/quality-control.md` (Compare with character references); `runs/run-page.md` (Cast panel); `blueprints/sharing.md` (several roles); `concepts/glossary.md` (run role, cast).

**Spec:** §3.4 `roles` comment; §6.1 add `cast`; §16.2 remove "more than one role", add cast/run-role rules; §16.3 new warnings; §18.1 record explicit selection replaced `ReferencePolicy`; §18.5 rewrite "Many characters: explicit budget"; §18.6 resolved except roles-as-inputs; new §18.7 "Run roles"; §28 revision. **ADR-0016** "Multi-character reference budget: explicit, validated, no automatic degradation".

**Packages:** `package-export.service.ts:237,305` iterate over all `source:'channel'` roles, one character slot each (`character-<roleKey>` already keys by role, `:342`); `launch`/`run` roles export as-is; install fills N slots (`package-install.service.ts`); `PACKAGE_FORMAT_VERSION` stays 1 (`slots[]` already an array).

## Steps (one commit each; one PR `feat: multi-character shots and run-generated characters`, branch `feat/characters-cast`)

1. `feat(shared)`: many roles with channel/launch/run sources, `cast` ref, `qc.compareReferences` (incl. guide Ref coverage).
2. `feat(api)`: count identity references per stage across roles.
3. `feat(api)`: validate many roles, cast bindings and run roles.
4. `feat(api)`: resolve cast and run roles with per-part provenance (+ closure recursion, provenance mislabel fix).
5. `feat(api)`: label multi-character reference images in media prompts (single role byte-identical).
6. `feat(api)`: fail an over-budget cast before reserving spend.
7. `feat(api)`: let QC compare an image with its character references.
8. `feat(api)`: choose a channel character when starting a run (`launch`; optional, Q3).
9. `feat(api)`: promote a run-generated character to the channel.
10. `feat(api)`: export/import packages with several roles.
11. `feat(web)`: roles list, cast binding, run cast panel, promotion.
12. `docs`: assistant guide + recipe, `apps/docs`, spec, ADR-0016.
13. `test(api)`: e2e for casts, run roles, seeding, promotion.

## Tests

- **Unit:** reference counting (incl. `coalesce`, `take`); prompt labels and ordering vs `collectSourceKeys`; cast resolution with `pick` order and unknown keys; run-role resolution for `one`/`many`; closure recursion through `parts`; validator matrix (undeclared cast key, run-role writer after consumer, missing name/description in the sheet schema, `enabledWhen` mismatch, sum over budget with/without `pick.maxItems`); package export of 2 roles.
- **E2E:** `cast-multi-character.e2e.test.ts` (2 channel characters on the fake provider, maxRefs 4: static over-budget cast rejected at save; dynamic over-budget cast fails before any ledger reservation — assert no `ledger_entry`; provenance records both characters' blob ids). `run-role.e2e.test.ts` (design -> sheet image -> shots iterating; retrying `design_hero` invalidates every shot and tombstones `heroSheet`/`heroRef`; a seeded run reusing stages keeps the same artifact ids; `rerunStageKeys:['design_hero']` regenerates). `promote-run-role.e2e.test.ts` (promotion creates a ready Character with copied `scope='character'` blobs whose object keys differ from the run blobs; deleting the run leaves the Character intact). Extend `run-service.e2e.test.ts` with optional-role skip and launch-role choice.

## Risks

- **Prompt drift for existing single-role blueprints:** single-role output kept byte-identical (step 5).
- **Providers may ignore which image is which:** labels help, identity mixing in two-character shots is a model limitation; docs recommend a turnaround sheet per character and small casts; `compareReferences` catches mixing on images, approval on video.
- **`members:'many'` alignment:** a sheet array retried with a different length must tombstone extra `castRef#i` — holds for indexed groups (§6.3), covered by e2e.
- **Unbounded dynamic `pick`:** warning at save; runtime failure costs nothing but needs a re-plan; the recipe adds `maxItems`.

## Migration, compatibility and delete cascade

- **No DB migration.** `roles`/`role_bindings` are jsonb; old `RoleDef` parse with `source` defaulting to `channel`; old runs' `role_bindings` resolve as before.
- **No new tables, no new FKs.** Run roles are `run_memory` rows + `artifact`s + run blobs (already in `deleteRunsCascade`, `run-cascade.ts:46-73`). Promoted Characters are ordinary `character` rows with `scope='character'` blobs, covered by `ChannelService.delete` (`channel.service.ts:168-206`) and `CharacterService.delete` (`queueStorageOrphans`, `character.service.ts:58-75`). Add an assertion to `channel-delete-cascade.e2e.test.ts` (`:313`) that a **promoted** Character's copied blob is queued in `storage_orphan` on channel delete — the one new path that creates character blobs.

## Open decisions (default in bold)

1. No auto-degradation (D2): fail before spend with guidance, or opt-in automatic "primary-only when over budget" per binding? **Fail with guidance.**
2. Generate **one turnaround-sheet image per character** as the recipe default (fits 4–5 refs), or separate view images? **Turnaround sheet.**
3. Include `source:'launch'` (pick a channel character when starting each run)? **Include (small); drop if "different character per run" only meant generated.**
4. Identity consistency: vision-LLM judge with `compareReferences` (images only) is v1; a local face-embedding similarity check later (a new local model service like Qwen-TTS = runtime-image change)? **Judge only for v1.**
5. Promotion: always create a new Character, or also "add these images to an existing Character" (reuses `promoteReference`)? **New only for v1.**
