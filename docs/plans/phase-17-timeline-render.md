# Phase 17 — Richer timeline and render

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F6).
Baseline: `main` at `4a1e381`. Independent of the engine phases. Shares ffmpeg
helper patterns (derived blobs, `runFfmpeg` seam) with Phase 13.
Scope: cinematic controls on the timeline (effects, color grading, keyframed
animation, PiP/layouts, speed ramps, richer transitions and audio) with one
composition for editor preview and final render. Plan for long-form rendering;
do not build chunked rendering yet.

## Current state

- **Schema** (`packages/shared/src/timeline.ts:53-125`): media items have `fit`, `overflow`, `volume`, fades, a 3-preset `motion` (`ken_burns|zoom_in|pan`) and in/out transitions (`cut|crossfade|slide|wipe`). Text items have style and position. Captions have pages and style overrides. Tracks have `duckUnder`. `version: z.literal(1)`.
- **Composition:** one `TimelineComposition`, used by the web `@remotion/player` (`preview-panel.tsx:12`) and the render worker (`apps/render-worker/src/cli.ts`). Parity holds by construction.
- **Render:** `timelineRenderSpec` copies every resource into the job directory and runs the worker as one compute job (`assembly.capability.ts:200-258,286-298`).
- **Checks:** schema, handles, styles, source bounds, coverage, A/V alignment, canvas (`timeline-check.service.ts:26-216`). Model-facing JSON-schema is a hand-kept copy (`provider/timeline-output-schema.ts`).
- **Editor:** inspector has fields only (`item-inspector.tsx:157-430`); edit operations are pure functions in `pages/timeline-editor/edit-ops.ts`.

## Bugs found on the way (fix first, PR F6.0)

| #   | Finding                                                                                                                                                                                        | Evidence                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| B4  | `overflow: loop/freeze/speed` is accepted and exempt from the source-length check, but the renderer ignores it; a clip set to `speed`/`loop` renders a short source as black or frozen frames. | `timeline.ts:67`, `timeline-check.service.ts:167`, `packages/timeline-composition/src/index.tsx:88-145` |
| B5  | Fades on audio items do nothing to the sound (`fadeInSec`/`fadeOutSec` only change opacity); duck level hard-coded to 0.3.                                                                     | `render-helpers.ts:188-216`, `index.tsx:121-127`                                                        |
| B9  | The render worker re-bundles Remotion on every render; no `frameRange`, `concurrency` or `scale`; draft vs final differ only in `crf`.                                                         | `apps/render-worker/src/cli.ts:38,45-53`                                                                |

## Design

### Schema extension (additive; all optional; validated in Zod)

```ts
const Ease = z.enum(['linear', 'in', 'out', 'in_out', 'hold']);
const Keyframes = z.array(z.object({ atSec: finiteNonNegative, value: z.number().finite(), ease: Ease.optional() })).min(1);

const Box = z.object({                    // % of canvas; absent = full frame (today's behaviour)
  x: z.number().finite(), y: z.number().finite(), width: finitePositive, height: finitePositive,
  rotationDeg: z.number().finite().optional(), radiusPct: z.number().min(0).max(50).optional(),
  border: z.object({ widthPx: finiteNonNegative, color: z.string() }).optional(),
  shadow: z.boolean().optional(),
  crop: z.object({ top: pct, right: pct, bottom: pct, left: pct }).optional(),
});
const Grade = z.object({
  exposure: z.number().min(-3).max(3).optional(),     // stops
  contrast: z.number().min(0).max(2).optional(),
  saturation: z.number().min(0).max(2).optional(),
  temperature: z.number().min(-1).max(1).optional(),
  tint: z.number().min(-1).max(1).optional(),
  lookId: z.string().optional(), lookStrength: z.number().min(0).max(1).optional(),
});
// media item additions
speed?: z.number().min(0.1).max(8),          // constant playback rate
speedRamp?: Keyframes,                       // rate over item time; conformed (below)
box?: Box, grade?: Grade,
blend?: z.enum(['normal','multiply','screen','overlay','soft_light','lighten','darken','difference']),
mask?: z.object({ shape: z.enum(['rect','ellipse','rounded']), featherPct: pct.optional() }),
blurPx?: finiteNonNegative,
animate?: { opacity?, x?, y?, scale?, rotationDeg?, volume?: Keyframes },   // text items get the same minus volume
// MediaTransition.type adds: 'dip_black','dip_white','zoom','blur','push'
// Track: duckDb?: z.number().max(0)     (replaces the hard-coded 0.3)
// canvas: grade?: Grade, audio?: { targetLufs: z.number().min(-40).max(-5), truePeakDb?: z.number().max(0) }
```

Refinements: keyframes sorted; `animate` values within domain (opacity 0–1); `speed` and `speedRamp` mutually exclusive; fades + transitions follow the existing rule. `motion` stays as preset sugar, not migrated.

### Versioning

Readers accept `version: 1 | 2`. Writers emit `2` only when a timeline uses any field added after 1 (pure `timelineVersionFor(t)` in shared). Why: the in-app updater can roll back to an older image, and Zod strips unknown keys, so an old binary would silently drop grades/boxes; with the bump it rejects with a schema error instead. Stored rows are never rewritten; upgrades happen on read. Add `upgradeTimeline()` behind `z.preprocess` only if a field ever changes meaning.

### Rendering (all in `packages/timeline-composition`)

- **Parity rule:** every visual feature is plain CSS/SVG in the shared composition so the Player and Chrome-headless render produce identical pixels. Two exceptions where preview differs: loudness normalization and speed ramps (below).
- **B4 fix:** `loop` -> `<Loop>`; `freeze` -> `<Freeze>` on the last source frame; `speed` -> `playbackRate = sourceSec / durationSec`.
- **B5 fix:** the volume callback multiplies by the fade envelope and `animate.volume` via Remotion `interpolate` + `Easing`.
- **Box / PiP / layouts:** absolutely positioned wrapper with geometry, border radius, border, shadow, `overflow:hidden`, and `clip-path` for crop; `fit` applies inside the box. Split screen, grid, inset are **editor presets** writing boxes onto several tracks — no layout enum in the schema (YAGNI).
- **Blend / mask:** CSS `mix-blend-mode` (with `isolation:isolate` on the root); `mask-image` radial/linear gradients for shapes and feather.
- **Grade:** per item and at canvas level via an inline `<svg><filter>` per graded item (`color-interpolation-filters="sRGB"`): `feComponentTransfer type="table"` with 1D tables per channel computed in JS from exposure (2^stops gain), contrast (pivot 0.5), temperature and tint (R/B and G gains), then `feColorMatrix type="saturate"`. Exact for per-channel operations; identical in Player and render. Looks: a `LookRegistry` mirroring `StyleRegistry` (`capability/style.registry.ts:273`); each look id maps to Grade parameters (warm film, teal and orange, bleach bypass, noir); served by `GET /looks` and passed to the render in `resources.json` beside styles (`assembly.capability.ts:252`). Parameter-based looks need no LUT files, so no Dockerfile change.
- **Keyframes:** pure exported `valueAt(keyframes, sec)`. Transforms compose as transition look, then box, then animate, then motion.
- **Transitions library:** extend `transitionLook` (`render-helpers.ts:188+`); opacity/filter/transform only, so parity holds.
- **Speed ramps and 3D LUTs — "conform":** variable playback rate cannot be expressed on Remotion `<Video>`; a `.cube` LUT has no CSS equivalent. An API-side `ConformService` produces a derived intermediate with ffmpeg (`setpts` piecewise expression; audio `atempo` per segment or `mute`; `lut3d`), cached as a derived blob keyed by sha1(source blob + conform params) (same pattern as Phase 13). Both the editor Player (signed URL) and `timeline.render` resolve the handle to the conformed blob. The editor shows "Processing speed ramp…" until ready. Conform runs on `ComputeJobService` (full re-encode).
- **Loudness:** if `canvas.audio.targetLufs` is set, the render worker post-processes with ffmpeg two-pass `loudnorm`, copying the video stream. Preview is not normalized (documented; editor badge "Loudness applied on render").

### Validation and checks (`timeline-check.service.ts`)

`timeline.source_bounds` becomes speed-aware (source seconds needed = trimIn + duration x speed, or the ramp integral); `loop`/`freeze` remain exempt because they are now real. New `timeline.looks_exist` (same shape as `styles_exist`, `:140-154`); new `timeline.keyframes_in_range` (fails when a keyframe lies past the item's duration, with `targets` for editor highlighting). Range errors stay in Zod so editor and API agree. `timeline-output-schema.ts` (model-facing) exposes a deliberately small subset: `speed`, `grade.lookId`, the new transition types, `canvas.audio.targetLufs`. Keyframes/boxes/masks stay editor-only at first (Q6).

### Performance and long timelines

_Now (F6.6):_ cache the Remotion bundle per worker build (`cli.ts:38` re-bundles on every render; key on worker version); expose `concurrency`; draft renders use `scale: 0.5`.
_Later, designed not built:_ chunked rendering — capability splits frames into N ranges (preferring item boundaries); each range is a ComputeJob running `renderMedia({frameRange, muted:true})`; one audio-only pass renders the full mix; ffmpeg concat demuxer `-c copy`, then mux audio and apply loudnorm; the capability holds a composite handle (list of compute handles) and polls all. For 2–3 hour work, stop copying every resource into each job directory (`assembly.capability.ts:211-230`): one shared read-only resource directory per render, or signed MinIO URLs Remotion streams. The editor's track rendering will need virtualization; Remotion `Sequence` mounting is already range-limited (`index.tsx:296-301`).

### Editor UI — MVP is inspector panels, not keyframe lanes

Layout (box fields + presets: Full, Inset x4 corners, Split left/right, Split top/bottom, Grid 2x2 — pure functions in `edit-ops.ts`); Look (dropdown + exposure/contrast/saturation/temperature/tint sliders + Reset; canvas-level grade in the timeline header); Animate (per property a "From -> To" pair with ease = two keyframes; lanes later); Speed (constant rate; "Speed ramp" presets slow-mo middle / ramp in / ramp out write keyframes); Audio (volume From->To, duck level on the track, project loudness target); Blend and mask (two selects); Transitions (extended list).

## Phased delivery (one PR per sub-feature; one commit per step)

| PR     | Content                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F6.0   | `fix(render)`: honour overflow loop/freeze/speed, audio fades, duck level (B4, B5); `duckDb`; speed-aware `source_bounds`; docs. **Candidate for Wave 0** (output of existing timelines using `overflow` changes — call out in changelog). |
| F6.1   | Layout boxes, PiP/split/grid presets, blend, mask: shared schema + `timelineVersionFor`; composition; checks; inspector + edit-ops presets; docs/guide                                                                                     |
| F6.2   | Keyframed animation: `valueAt` + schema; composition; `keyframes_in_range`; From->To inspector; docs                                                                                                                                       |
| F6.3   | Color grading + looks: Grade schema; SVG filter builder; `LookRegistry` + `GET /looks` + `looks_exist`; inspector; docs                                                                                                                    |
| F6.4   | Transitions library + audio automation + loudness: transition looks; volume keyframes; render-worker loudnorm post-pass; docs                                                                                                              |
| F6.5   | Constant speed + speed ramps via conform: `ConformService` (derived blob, ComputeJob); resolver uses conformed blob; inspector; docs                                                                                                       |
| F6.6   | Render performance: bundle cache; `concurrency`; draft `scale` (B9)                                                                                                                                                                        |
| F6.7   | Multi-aspect renditions: `timeline.render` config `canvas?: {width,height}` + `reframe: 'cover'                                                                                                                                            | 'contain'`; authors add one render stage per aspect (fan-out; parallel after Phase 11). Overlay positions are already %, so they reflow |
| future | Chunked/parallel render, LUT files, audio EQ                                                                                                                                                                                               |

## Tests

- **Unit (shared/composition):** Zod refinements; `timelineVersionFor`; `valueAt` easing tables; grade-to-transfer-table math (identity grade = identity table); `transitionLook` new types; volume envelope; layout presets in `edit-ops.test.ts`.
- **Unit (API):** timeline checks (speed-aware bounds, looks, keyframes); conform argv snapshot; loudnorm argv; `timelineRenderSpec` carries looks.
- **E2E:** `human.timeline_edit` -> `timeline.render` with a v2 timeline using the stubbed compute path of the existing render e2e; checks run through the API; a v2 timeline round-trips through save and the editor DTO.
- **Acceptance (local; Chrome + ffmpeg):** extend `test/acceptance/phase6-render.ts`: render a timeline with PiP, a grade, keyframes, a speed ramp; compare sampled-frame luma/chroma to expected ranges (using Phase 13's analysis/frame helpers); assert output LUFS within ±1 LU of target; measure render-time cost of SVG filters.

## Cost model

$0 provider cost (local compute; ledger unchanged, `costUsd: 0`, `assembly.capability.ts:307`). Real cost is wall clock: SVG filters and masks can slow headless Chrome; conform is a re-encode per ramped/LUT'd clip, cached.

## Risks

SVG filter performance in headless Chrome (measure in acceptance); `mix-blend-mode` with video layers needs isolation correctness; updater rollback (version bump); editor Player cannot preview loudness and ramps preview only once conformed; model-written timelines misusing new fields (expose a subset only).

## Migration and compatibility

Version-1 timelines untouched and valid. No DB migration (timelines are `artifact.data` jsonb). The B4 fix changes the output of existing timelines that use `overflow: speed|loop|freeze`: a fix, called out in the PR and changelog. No Dockerfile change unless fonts or `.cube` LUTs ship (then `RUNTIME_VERSION` bump).

## Open decisions (default in bold)

5. Emit `version: 2` only when new fields are used (rollback rejects rather than silently drops)? **Yes.**
6. Which new fields may timeline-writing LLM stages use? **`speed`, `lookId`, new transitions, loudness target only.**
7. User-uploaded `.cube` LUTs (new asset kind + conform), or parameter looks only for now? **Parameter looks only.**
8. Audio EQ ("voice clarity") now or later? **Later.**
9. Multi-aspect: one render stage per aspect, or one stage producing a list of renditions? **One stage per aspect.**
