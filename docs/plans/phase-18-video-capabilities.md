# Phase 18 — Video generation capabilities and providers

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F8).
Baseline: `main` at `4a1e381`. **F8.1 ("fal done right") is correctness work and
is pulled forward into Wave 0** of the master plan; the rest follows Phase 11
(cross-stage frames use `{from:'stage'}`) and, for character voices, Phase 15.
Scope: cover what multi-clip narrative workflows need, in priority order; make
adding a model a one-entry change with correct cost accounting; test everything
free with the fake provider.

## Current state

- `video.generate` slots `startFrame`, `endFrame` (one each), `references` (many) (`media-generate.capability.ts:239-256`); requests pass through as `params.slots` (`:104-116`).
- fal: one hard-coded model with bugs B1/B2 (`fal.adapter.ts:24-42,52-57,143`).
- `browser.flow_video` produces `media.video_list` through Codex + BrowserOS Neo (`flow-video.capability.ts:73-82`).
- Frames: last/first frame only within the same iterating stage (B10). Poster frames for thumbnails.
- Audio: ElevenLabs, Deepgram, Qwen speech, Deepgram alignment (`provider.module.ts:31-46`). **Characters have no voice field** (`packages/shared/src/character.ts`).
- Fake provider: `fake-video-1` returns text unless a test supplies `fakeOutput` (`fake-provider.adapter.ts:117-131,310-315`); dry runs map fake models by modality (`run.service.ts:609-614`).
- Spec §7.3 already reserves `image.edit` (background removal, inpaint, restyle), `video.transform` (upscale, lip-sync, extend, restyle), `audio.music`, `audio.sfx` (spec `:835-841`).
- Keys resolve through `KEY_PROVIDER`, fal mapped to `FAL_KEY` (`key-provider.ts:19,57-61`).

## Bugs found on the way (Wave 0)

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **The fal adapter never sends start frames, end frames or references.** `submit` spreads `req.params` into the fal body, which includes `slots` (storage descriptors with `sourceKey`, not URLs) and the estimate-only `pricePerSecondUsd`. No slot is mapped to a fal image field, so image-to-video most likely runs as text-to-video. The user guide says frames/references work (`apps/docs/docs/stage-types/generate-video.md:25`). No `fal.adapter.test.ts` exists. | `fal.adapter.ts:52-57`, `media-generate.capability.ts:104-116`                                                                     |
| B2  | **fal spend is recorded as $0.** `fetch` returns `costUsd: 0`; the runner settles with `actualUsd: result.costUsd`, so the ledger and budget caps under-count the most expensive stage.                                                                                                                                                                                                                                                                                   | `fal.adapter.ts:143`, `stage-runner.service.ts:963,990,1017,1181`                                                                  |
| B3  | **Model limits for duration, aspect ratio, video inputs are declared but never checked.** Spec §8 promises the validator rejects "a 12-second clip from a model that generates 5 or 10". Only `maxRefs` is enforced.                                                                                                                                                                                                                                                      | `packages/shared/src/provider.ts:69-77`; spec `:889`; enforcement only at `blueprint.service.ts:786-810`, `run.service.ts:481-498` |
| B10 | A last frame can only be taken from the previous item of the same iterating stage (`{from:'prevItem'}`), not from another stage's clip.                                                                                                                                                                                                                                                                                                                                   | `blueprint/binding-types.ts:210`, `binding-resolver.service.ts:368,514`                                                            |

## Priority (what narrative multi-clip workflows need most)

1. **P0 fal done right:** B1, B2, a model registry table, model-limit validation (B3). Without it every paid video feature is mis-wired or mis-billed.
2. **P1 cross-stage frames:** `lastFrame`/`firstFrame` on `{from:'prev'}`/`{from:'stage'}` media.video refs, and on list refs as `lastFrame` of the last clip. Free; unlocks "scene N continues from scene N-1" across stages; also native **extend-by-continuation** (image-to-video seeded with the previous clip's last frame).
3. **P2 lip-sync** (`video.transform` `operation: 'lipsync'`) — dialogue is the core of narrative.
4. **P3 consistent character voices** — a voice binding on the Character; cloning itself happens in ElevenLabs, Reelcraft picks the voice id.
5. **P4 `audio.sfx` / `audio.music`** — ElevenLabs sound effects reuses the existing key; fal hosts music and video-to-audio models.
6. **P5** native `extend`, `restyle` (v2v), `upscale`, `interpolate`, `image.edit` (background removal), video matting (alpha); dubbing last.

**Recommended first slice:** P0 + P1; then one lip-sync model.

## Design

### Model registry (`apps/api/src/provider/fal/fal-models.ts`)

```ts
interface FalModel {
  modelId: string; // fal endpoint id per task (text-to-video vs image-to-video are separate endpoints; verify ids)
  label: string;
  task:
    | 'video.generate'
    | `video.transform:${'lipsync' | 'extend' | 'restyle' | 'upscale' | 'interpolate' | 'matte'}`
    | 'audio.sfx'
    | 'audio.music'
    | 'image.edit:remove_background';
  capabilities: ModelCapabilities;
  /** slots + params -> fal body. Only declared params pass; internal keys never leak. */
  toPayload(
    req: ProviderRequest,
    files: Record<string, string /* data URI or fal URL */>,
  ): Record<string, unknown>;
  outputOf(body: unknown): MediaSource;
  pricing: { unit: 'second' | 'clip' | 'image' | 'megapixel'; usd: number };
}
```

- `FalAdapter.listModels()` returns the table; `submit` looks up the entry and resolves slot files with `loadReferenceFiles` (`provider/reference-files.ts:22`) as data URIs. Large video/audio inputs are uploaded to fal storage first (privacy decision, Q10).
- `estimate`: `pricing.usd x requested units`, `ceilingUsd` at the maximum allowed duration, `basis: 'configured_ceiling'`. `fetch` returns `costUsd` from the same price function for billed units (fixes B2). `pricePerSecondUsd` stays as a documented override, stripped from the payload. `// ponytail: price table, not live billing; update when fal changes prices`.

### Shared `ModelCapabilities` (`packages/shared/src/provider.ts:53`)

Add `tasks?: string[]` (what a model serves, e.g. `['video.generate']`, `['video.transform:lipsync']`), `pricing?: {unit, usd}` (editor estimate line), and extend `video.inputs` with `'video'` and `'audio'`. Models that don't declare `tasks` are treated as serving their modality's default capability (backward compat).

### Capability negotiation

At save (`blueprint.service.ts`) and run start (`run.service.ts:481`), enforce B3: the stage's capability/operation must be in `model.tasks`; `params.duration` in `video.durationsSec`; `params.aspect_ratio` in `aspectRatios`; each bound slot in `video.inputs` (no `endFrame` on a model without it). Messages name the model and allowed values; the model picker filters by task. **Runtime fallback (`ModelPin.fallbacks`) is not built now** — it changes retry/reservation semantics (project rule: retryLimit is crashes only); Q11.

### `video.transform` capability (`media-generate.capability.ts`, extends `ProviderMediaCapability`)

Config `operation`; `slots(cfg)` depends on it (the interface already supports this):

| operation                 | slots                                                                          | notes                                                         |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `lipsync`                 | `video` (media.video) or `face` (media.image), `audio` (media.audio, required) | validator: exactly one of video/face                          |
| `extend`                  | `video` (required) + prompt                                                    | `providerMeta.includesSource` recorded; Q12                   |
| `restyle`                 | `video`, `references` (many)                                                   |                                                               |
| `upscale` / `interpolate` | `video`                                                                        | params `scale` / `targetFps` validated against model metadata |
| `matte`                   | `video`                                                                        | output format open (alpha WebM vs grayscale matte), Q13       |

`image.edit` (spec `:835`): `remove_background`, slot `image`, PNG with alpha (composites with Phase 17 boxes). `audio.sfx`/`audio.music`: prompt-driven, config `durationSec`; `audio.sfx` takes an optional `video` slot for video-to-audio models. None of these may declare `qc` without a framesheet (falls out of Phase 13, outputs are `media.video`).

### Cross-stage frames (P1)

`binding-types.ts:210` accepts `lastFrame`/`firstFrame` on any ref whose base type is `media.video`, or `media.video_list` (last/first clip). `binding-resolver.service.ts` (`case 'stage'`/`'prev'`) calls `derivedFrames.extract(row, path)`; for lists, from the clip blob; cached as today. (Needs Phase 11's `{from:'stage'}`; `prev` support can ship earlier.)

### Character voices (P3)

`character.voice?: { provider, voiceId, modelId?, params? }` — needs a migration, but `character` is not in the run cascade so no cascade obligation. When `audio.speech`'s `text` slot comes from a role-bound context, the role's voice overrides `config.params.voice`. **Coordinate with Phase 15** (touches `{from:'role'}`/`cast` resolution); schedule after it. Voice cloning = link to ElevenLabs Voice Lab; Reelcraft only lists voices (`listVoices`, `provider-adapter.interface.ts:87`). Q15: voice on the Character (proposed) vs the channel's role binding.

### Fake provider (`fake-provider.adapter.ts`)

`fake-video-1` default output becomes a checked-in tiny valid MP4 fixture (a few KB, made once with ffmpeg) so `fakeOutput` is no longer needed. Add models with `tasks` metadata: `fake-lipsync-1`, `fake-video-extend-1`, `fake-video-restyle-1`, `fake-upscale-1`, `fake-sfx-1`, `fake-music-1`, `fake-bg-remove-1`; each echoes the slot names/keys it received in `rawResponse.receivedSlots` (e2e asserts the wiring) and honours `fakeCostUsd`, `slow:N`, `fail:`. Dry-run mapping (`run.service.ts:609`) becomes a lookup by task (capability:operation), falling back to modality.

### Checklist for adding a provider model

1. Entry in the provider's model table: `modelId`, `task`, `capabilities` (durations, aspects, inputs, maxRefs, hasAudio), `pricing`.
2. `toPayload`: map only declared slots/params; never spread `req.params`; payload snapshot test.
3. `outputOf`: return a `MediaSource` with `sourceUrl`/`base64` and `mime`.
4. `estimate` and `fetch` share one price function; test a 10 s request gives the expected `costUsd`.
5. Keys only via `KEY_PROVIDER` (`this.keys.get(id)`).
6. A fake model with the same `task`/`capabilities` shape, added to the dry-run mapping.
7. Validator is automatic via `tasks` and limits; add one negative test per new limit kind.
8. User guide: stage-type page model list and limits; `reference/costs.md`.
9. Assistant guide: capability and operation list.

## Steps and PRs

- **F8.1 "fal done right"** (Wave 0 PR): `fix(api)` map video slots to fal inputs and record fal spend (B1, B2) with a new `fal.adapter.test.ts` (mocked `fetch`); `feat(shared)` model tasks/pricing metadata; `feat(api)` fal model table (Kling i2v with end frame, t2v); `feat(api)` validate model durations/aspect ratios/inputs (B3); `feat(api)` fake video fixture and task-aware fakes; `feat(web)` model picker filtered by task + estimate; `docs`.
- **F8.2 cross-stage frames:** binding types; resolver; e2e; docs. (After Phase 11.)
- **F8.3 `video.transform` lipsync:** capability + validator; fal lipsync entry; fake; web stage form; docs and guide.
- **F8.4 character voices:** schema + migration; resolution; UI; docs. (After Phase 15.)
- **F8.5 `audio.sfx`/`audio.music`:** ElevenLabs sound effects; fal entries; fakes; docs.
- **F8.6 remaining operations:** extend, restyle, upscale, interpolate, `image.edit` background removal, matte.

## Tests

- **Unit:** adapter payload snapshots per model; internal-param stripping; cost (`estimate` ceiling ≥ `fetch` actual); `poll` state mapping; validator (tasks, durations, aspects, inputs; `endFrame` rejected on a model without it); `video.transform.slots(cfg)` per operation.
- **E2E (fake only):** lip-sync graph `image.generate` -> `audio.speech` -> `video.transform{lipsync}` asserts `receivedSlots` and ledger settlement equal to `fakeCostUsd`; cross-stage `lastFrame` binding with stubbed `DerivedFrameService`; dry run of a graph using every new capability.
- **No paid live tests in CI** (project memory: only ChatGPT is usable live; fal covered by unit tests). An optional local script gated by `FAL_KEY` may exist, never run in CI.

## Cost model

Paid provider stages go through the existing reserve/settle path (`ledger.service.ts:55-222`): reservation uses `estimate().ceilingUsd`, `settleSuccess` uses `fetch().costUsd`. Money columns already go through `toUsd`/`fromUsd` inside `LedgerService`; adapters deal only in numbers. `CostEstimate.basis` stays `configured_ceiling` for table-priced providers (spec `:891`). Editor shows "≈ $X per clip" from `pricing`.

## Risks

fal endpoint ids, field names and prices change (one table, payload snapshots, dated price comments); uploading user media to fal storage has privacy/retention implications; lip-sync and matting quality vary widely (human approval remains the gate); the `tasks` field must default sensibly for every existing adapter (ChatGPT image, ElevenLabs, …) or the validator will reject current blueprints — **test with all existing builtin templates**.

## Migration and compatibility

Pinned `fal-ai/kling-video/v3/standard` must keep resolving (alias entry). `pricePerSecondUsd` still works as an override. Existing blueprints with an out-of-range `duration` that used to run unchecked will now fail validation at save or run start: release note + clear message.

## Open decisions (default in bold)

10. May Reelcraft upload user media (source video, voice audio) to fal storage for lip-sync/restyle/extend? **Yes, with a Settings switch to forbid it.**
11. `ModelPin.fallbacks`? **Not now.**
12. Should "extend" results be normalised to the extension only? **Keep whatever the model returns; record `includesSource`.**
13. Matting format: **alpha WebM through Remotion.**
14. First fal models: **one Kling image-to-video with end frame; one lip-sync; ElevenLabs for sound effects.**
15. Character voice on the Character (**proposed**) or on the channel's role binding?
