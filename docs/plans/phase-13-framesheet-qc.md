# Phase 13 — QC on video via framesheets

Status: implementation plan (not started). Part of
[`master-plan-complex-workflows.md`](master-plan-complex-workflows.md) (feature F5).
Baseline: `main` at `4a1e381`. Independent of Phases 11/12; its structured
verdict feeds Phase 12's later "auto" upstream routing.
Scope: let an AI judge screen generated video from one to three labelled
contact-sheet images (a **framesheet**), plus free signal checks for what stills
cannot show. Human approval stays the gate for motion, lip-sync and audio quality.

## Goal

Catch what stills show: wrong subject, identity drift, broken anatomy,
unreadable text, wrong framing, mismatch with the start frame, blank output.
Free signal checks (black, frozen, silent, loudness) cover the rest cheaply.

## Current state

- Validator: `qc` on `media.video` is an error (`blueprint-validator.service.ts:293-299`); `includeTranscript` allowed on audio only (`:301-307`).
- Video **lists** are judged by attaching every clip, which needs a judge that watches video (`stage-runner.service.ts:1428`, `qc-runner.service.ts:195-203`; `blueprint.service.ts:516-529`; `qc-video.ts:10-23`). The spec is already out of date: §10.1 forbids QC on video and §10.3 says "frame sampling and contact sheets have no place here" (spec `:960-966,:984`).
- QC envelope already carries `images[]` with labels (`qc/qc-envelope.ts:24-28`); prompt already explains multi-image sets (`qc/qc-prompt.ts:32-50`); `judgeImagesProblem` bounds judge image count (`qc/qc-images.ts:16-34`).
- Verdict has `failedClips`/`selectedImage` but no per-issue location or source (`qc-runner.service.ts:8-16`, `qc-verdict.ts:5-21`).
- QC retries call the judge again on the same artifact (`stage-runner.service.ts:1924-1948`), so a cache keyed on the artifact makes retries free.
- Reusable: `DerivedFrameService` (cached ffmpeg frame cut with row lock, `derived-frame.service.ts:69-101`, last-frame trick `-sseof -0.1` at `:150`); `MediaPreviewService` already builds a 3-frame "mini framesheet" for the assistant (`media-preview.service.ts:26-30,86-106`); builtin checks are pure and read the stored probe (`check/check.types.ts:57-59`; probe written at `media-artifact.service.ts:70`); QC spend via `ledger.recordActual({category:'qc'})` with `qc.capUsd` pre-check (`stage-runner.service.ts:1367-1387,1455-1461`).
- The image already has what is needed: Ubuntu 24.04, ffmpeg 6.1, `fonts-liberation` (`docker/app/Dockerfile:52-62`) cover `drawtext`, `xstack`, `blackdetect`, `freezedetect`, `silencedetect`, `ebur128`, `loudnorm`, `scdet`. **No Dockerfile change and no `RUNTIME_VERSION` bump.**

## Bugs found on the way (fix first)

| #   | Finding                                                                                                                                                                                                                                                                       | Evidence                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| B6  | Frame images cut from a video (first/last frame, poster) are not collected when their source artifact goes stale: invalidation marks only `artifact.blobId`, not blobs recorded in `artifact.derived`. They live until the run is deleted; framesheets would add to the leak. | `run/invalidation.service.ts:313-327`, `derived-frame.service.ts:89-94` |
| B7  | The approval screen shows the QC verdict as raw JSON.                                                                                                                                                                                                                         | `apps/web/src/components/runs/approval-review-sheet.tsx:331-350`        |
| B8  | Spec §10.1/§10.3 out of date with code (above).                                                                                                                                                                                                                               | spec `:960-966,:984`                                                    |

## Why §10.1 forbade it, and the amendment

§10.1 gives two reasons: cost ("a vision call over sampled frames on every attempt, against the most expensive outputs") and honesty (the engine "cannot tell you the subject's face changed" without a judge). Both hold for _watching_ video. A framesheet changes the numbers: 1–3 images, roughly 1–4k input tokens; cents on OpenRouter, $0 on ChatGPT/Codex subscriptions; a Kling clip costs about $0.60–1.20 (5–10 s x the 0.12/s default at `fal.adapter.ts:45`). With item-mode chaining (§10.5), catching bad clip 2 before clips 3–5 are generated from it saves far more than the judge costs.

**Proposed spec text:** replace §10.1 with "Video QC is judged from stills, and only on request": a `media.video`/`media.video_list` stage may declare `qc` only if it sets `qc.media.framesheet` or picks a judge that declares video input. It is a filter for faults visible in stills, not a substitute for approval on motion, temporal coherence, lip-sync or audio; the judge prompt says so. Spend counts against `qc.capUsd`. Edit §10.3, the summary row at `:22`, the closing note at `:1875`, the validator rule list at `:1405`; add §9.4 "Media analysis".

## Design

### Shared schema (`packages/shared/src/qc.ts`)

```ts
export const FramesheetSpec = z.object({
  /** Frames per clip. Default: max(6, min(16, round(durationSec))). First and last always included. */
  frames: z.number().int().min(2).max(64).optional(),
  /** uniform: evenly spaced. scenes: a frame just after each detected cut, then evenly spaced to fill.
   *  boundaries (lists only): last frame of clip N next to first frame of clip N+1. */
  sampling: z.enum(['uniform', 'scenes', 'boundaries']).optional(),
  /** Tiles per sheet. Default 8 (~1 MP per sheet). */
  tilesPerSheet: z.number().int().min(1).max(16).optional(),
  /** Attach the stage's own input images (startFrame/endFrame) as separate reference images. */
  includeInputFrames: z.boolean().optional(),
});
QcDef.media = z.object({
  includeTranscript: z.boolean().optional(),
  framesheet: FramesheetSpec.optional(),
});
```

Bounds are validation errors the docs explain, not silent caps; a user-set value is always used as given.

### Verdict (for Phase 12 routing)

`qc-verdict.ts` plus a new shared `QcVerdictDto` (replacing `z.unknown()` at `dto/run.dto.ts:163,243`):

```ts
issues?: Array<{
  note: string; severity: 'minor' | 'major';
  atSec?: number; clip?: number; dimension?: string;
  /** 'output', or 'input:<slotName>' (e.g. 'input:startFrame'). The judge sees slot names only, so independence (§10.2) holds. */
  source?: 'output' | `input:${string}`;
}>;
evidence?: { framesheetBlobIds: string[]; frames: Array<{ sheet: number; tile: number; atSec: number; clip?: number }> };
```

The engine maps `input:<slot>` to an upstream `stageKey` through the attempt's `resolved_inputs` provenance. Phase 13 only exposes the data; Phase 12 owns routing. Unknown slots map to `output`.

### `FramesheetService` (`apps/api/src/artifact/framesheet.service.ts`, beside `DerivedFrameService`)

- _Pure exported functions_ (tested without ffmpeg, like `posterSeekSec`): `sampleTimes(durationSec, fps, spec, cuts?)`; `sheetLayout(w, h, count, tilesPerSheet)` (portrait 270x480 tiles in a 4x2 grid = 1080x960; landscape 480x270 in 2x4 = 960x1080; both ~1 MP, under common vision-model downscale thresholds); `tileArgs()`, `composeArgs()` build ffmpeg argv.
- _Extraction:_ one ffmpeg call per frame with input seeking (`-ss t -i src -frames:v 1 -vf scale=…`), cost scales with frame count not clip length; then one `xstack` composition with a `drawtext` label per tile (`#3 · 00:04.20`, Liberation Sans) as JPEG q≈3 (~150–300 KB). Labels also go in the prompt as JSON; if `drawtext` is missing on a dev machine, sheets are made without burned-in labels and the judge reads positions from the JSON. `scenes` adds one low-res decode pass (`scale=320:-2,select='gt(scene,0.3)',showinfo`) parsing `pts_time`.
- _Cache:_ on `artifact.derived` under `framesheet:<sha1(normalized spec)>[:<clipPos>]` as a list of blob ids, reusing the `FOR UPDATE` lock + re-check pattern (`derived-frame.service.ts:73-100`). Blobs `scope:'run'` via a generalized `objectKey.derived(…, ext)` (`storage/object-key.ts:40`). ffmpeg goes through a `protected runFfmpeg` so e2e tests override it (pattern `test/support/build-app.ts:40-52`).
- Runs inline like derived frames. `// ponytail: inline ffmpeg; move to ComputeJobService when sheets are taken from renders longer than ~10 min`.
- Retries after a QC error, `holdForQcRetry` and the approval screen reuse the same sheets; a new attempt makes a new artifact, hence new sheets (correct).

### Runner wiring (`stage-runner.service.ts:1389-1449`)

- With `stage.qc.media.framesheet` on a `media.video`/`media.video_list` output, build sheets and pass them as `images`.
- New envelope field `framesheet: { durationSec, fps, frames: [...] }`, copied explicitly in `buildQcEnvelope` (`qc-envelope.ts:60-105`) and covered by the leak test.
- `includeInputFrames` prepends the stage's startFrame/endFrame slot images labelled "expected first/last frame" (makes continuity concrete in item-mode `prevItem.lastFrame` chains).
- `includeTranscript` on video reuses `qcAudio.transcribe` (`:1396-1425`) with sentence timestamps; Deepgram cost recorded under `qc` as today.

### Prompt (`qc-prompt.ts`)

"Each attachment is a contact sheet of stills sampled from the video, read left-to-right, top-to-bottom; each tile is labelled with its frame number and timestamp." / "You cannot see motion or hear audio. Do not score anything stills cannot show. Say 'not judgeable from stills' in the critique for any criterion that needs motion." / "List each problem in `issues` with `atSec`, and with `source` when an input caused it."

### What stills can and cannot judge

| Can judge                                                          | Cannot judge; what covers it                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Subject/identity drift vs start frame or references                | Motion artifacts, morphing between samples -> approval                      |
| Composition, framing, letterboxing                                 | Temporal flicker -> optional `temporal_flicker` check (later, experimental) |
| On-screen text, logos, hands/anatomy at sampled moments            | Lip-sync -> approval (item mode)                                            |
| Continuity at clip boundaries (`boundaries`, `includeInputFrames`) | Audio quality/pacing -> transcript + `audio_silence`/`loudness` checks      |
| Blank/black/garbage output                                         | Black or frozen spans between samples -> `black_frames`, `frozen_frames`    |

### Free signal checks

Builtin checks stay pure. Extend `Probe` with optional `analysis: { blackSegments, frozenSegments, silentSegments: Seg[]; integratedLufs?; truePeakDb? }`. `MediaAnalysisService.analyze(file)` fills it in one ffmpeg pass (`-vf blackdetect=d=0.1:pix_th=0.1,freezedetect=n=0.003:d=0.5 -af silencedetect=n=-50dB:d=0.5,ebur128=peak=true -f null -`, parsing stderr). It runs only when the stage declares a check marked `requiresAnalysis` (`MediaArtifactService.persist` gets an `analyze` flag), so ordinary clips pay nothing. New builtins: `black_frames {maxSec}`, `frozen_frames {maxSec, ignoreEdgesSec?}`, `audio_silence {maxSec}`, `loudness {targetLufs, toleranceLu, maxTruePeakDb?}`. Missing `analysis` fails with "media analysis unavailable" and `fault: 'authoring'` — never passes silently. `temporal_flicker` (signalstats YDIF spikes) is deferred and flag-gated.

### `media.framesheet` capability (follow-up commit)

Sync compute capability: slot `source` (`media.video`|`media.video_list`), config `FramesheetSpec`, output `media.image` (one sheet) or `media.image_list`. Uses: feed a vision `text.generate` ("describe what happened; write the next shot continuing from it"), continuity review across a list with `boundaries`, human-review artifact. Same service and cache. Cross-stage `lastFrame`/`firstFrame` refs (B10) belong to Phase 18.

### Validator (`blueprint-validator.service.ts:293`, `blueprint.service.ts:516`)

`qc` on `media.video` with neither a framesheet nor a video-watching judge: error "Video quality control needs a framesheet, or a judge that watches video". With a framesheet, call `judgeImagesProblem(judge, sheets + inputFrames)`; sheet count from explicit `frames` or the default worst case of 16 frames (2 sheets). `includeTranscript` now allowed on video; `sampling:'boundaries'` lists only.

### Web

- `QcVerdictPanel` replacing raw JSON (`approval-review-sheet.tsx:331-350`): score, dimension bars, critique, issues with `atSec`/source chips; framesheet thumbnails open in a lightbox; clicking a tile seeks the video preview to `atSec`. Blob URLs from `BlobService.readUrl` via `evidence.framesheetBlobIds`. Logic in `qc-verdict.logic.ts` with a test (web imports types only from shared).
- Stage inspector QC section: "Judge from a framesheet" toggle with frames, sampling, input-frames switch, and an estimate line "≈ N sheets per attempt".

### Assistant and user docs

`assistant/guide.ts:131` and `guide-troubleshooting.ts:72` rewritten. `apps/docs/docs/blueprints/quality-control.md` new "Video: framesheets"; `reference/validation-messages.md:92`; `reference/built-in-checks.md` (4 new); `reference/costs.md`.

## Steps (one commit each; one PR `feat: QC on video via framesheets`, branch `feat/framesheet-qc`)

1. `fix(api)`: collect derived-frame blobs when their artifact goes stale (B6: include `artifact.derived` blob ids in the GC set at `invalidation.service.ts:313`) + test.
2. `feat(shared)`: framesheet spec, QC issues and typed QC verdict DTO.
3. `feat(api)`: framesheet sampling and layout with cached sheet extraction (pure functions + service).
4. `feat(api)`: judge video from framesheets in QC (envelope, prompt, runner, validator).
5. `feat(api)`: media analysis probe and black/frozen/silence/loudness checks.
6. `feat(web)`: show verdicts and framesheets on approval/attempts; framesheet QC controls.
7. `docs`: amend spec §10; user guide; assistant guide; ADR-0018.
8. `feat(api)`: `media.framesheet` capability (optional within the PR).

## Tests

- **Unit:** `sampleTimes` (edges always present, scene merge, density defaults, `boundaries` pairs); `sheetLayout` portrait/landscape; argv snapshots; envelope leak test with the new field; prompt snapshot; `JudgeResponse` with issues and `input:<slot>` mapping; validator cases; each analysis builtin against probe fixtures; ffmpeg stderr parsing from recorded fixture text.
- **E2E (fake provider, no paid calls):** `video.generate` (`fake-video-1` + `fakeOutput`) with `qc.media.framesheet`; judge `fake-text-vision` with a `fakeOutput` verdict and `fakeCostUsd`; `FramesheetService` subclassed with a stub `runFfmpeg` writing a fixture JPEG. Assert sheets attached as `qcImageN`, `evidence` saved, one `qc` ledger row per judge call, a judge error-then-retry (`fail:` mode) reuses cached blobs with no second extraction, `qc_budget_exhausted` respected. Extend `channel-delete-cascade.e2e.test.ts` to assert framesheet blobs are deleted and queued as orphans (no new table; run-scoped blobs).
- **Acceptance (local only, needs ffmpeg):** `apps/api/test/acceptance/qc-framesheet.ts` generates a `testsrc2` clip with a black middle second and silent tail; asserts sheet dimensions/labels and analysis segments.

## Cost model

Extraction $0 local. Judge: provider-reported `costUsd` -> `ledger.recordActual({category:'qc'})` (existing path, unreserved per the phase-3 decision, with `qc.capUsd` pre-check). Roughly 1.0–1.5k input tokens per sheet; 8–16 frames = 1–2 sheets; ≈ $0.003–0.02 per attempt on mid-tier OpenRouter vision models; $0 on ChatGPT/Codex. A transcript adds Deepgram per-minute cost under `qc`.

## Risks

- Judge may claim to see motion: prompt wording + approval kept for motion; documented.
- Model image limits/downscaling: ~1 MP per sheet and 270 px minimum tile; `tilesPerSheet` raisable with a docs warning.
- Storage ~0.3 MB per attempt; GC fixed in step 1.
- Scene detection on long renders is a full decode; inline is fine for clips, renders move to ComputeJob later (ponytail note).

## Backward compatibility

Additive optional fields only. Existing `media.video_list` QC with a video-watching judge unchanged. No DB migration (`artifact.derived`, `stage_attempt.qc_verdict` already jsonb).

## Open decisions (default in bold)

1. Accept relaxing §10.1 as above? **Yes.**
2. Default frames `max(6, min(16, round(durationSec)))`, 8 tiles per sheet; `scenes` sampling default instead of `uniform`? **Uniform default.**
3. Allow Deepgram transcript on video QC (paid, under `qc`)? **Yes, opt-in.**
4. Ship signal checks in this PR or their own? **Same PR (step 5); skip `temporal_flicker`.**
