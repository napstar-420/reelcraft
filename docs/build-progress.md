# Reefcraft Build Progress

Tracks design-spec §24 Build Order phases. Each phase gets its own detailed
plan (via `/plan`) written just before it starts — this table is the index.

| #   | Phase                    | Status            | Plan                                     | PR(s)                  |
| --- | ------------------------ | ----------------- | ---------------------------------------- | ---------------------- |
| 1   | Skeleton                 | done              | —                                        | (initial commit)       |
| 2   | Core loop                | done              | `.claude/plans/crispy-drifting-cocke.md` | #1, #4, #5, #6, #7, #8 |
| 3   | Budget                   | done              | `.claude/plans/phase-3-budget-*.md`      | #9, #10                |
| 4   | Inputs & human-in-loop   | done (chunks 1–7) | `.claude/plans/phase-4-inputs-hitl.md`   | #11, #12, #13          |
| 5   | Media                    | done              | —                                        | #14                    |
| 6   | Assembly                 | done              | `docs/plans/phase-6-assembly.md`         | #16                    |
| 7   | Iteration                | done              | `docs/plans/phase-7-iteration.md`        | #17                    |
| 8   | Characters               | done              | `docs/plans/phase-8-characters.md`       | #18                    |
| 9   | Editor & templates       | done              | `docs/plans/phase-9-editor-templates.md` | #19                    |
| 9.5 | Visual graph canvas      | done              | `docs/plans/phase-9.5-visual-canvas.md`  | #20                    |
| 10  | Live updates (Socket.IO) | pending           |                                          |                        |

## Phase scope (one-liners, from design spec §24)

- **2 Core loop**: config resolver, binding resolver (slots/context), restricted
  JSON Schema + Ajv, compatibility walker (§16.4), template paths, builtin +
  script checks (QuickJS sandbox), QC, semantic retry. Test: a three-stage text
  blueprint with user schemas and a cross-artifact script check.
- **3 Budget**: ledger, row-locked reserve/reconcile, `PAUSED_BUDGET`, orphan sweep.
- **4 Inputs & HITL**: run inputs, channel assets, Run Memory + tombstones, stage
  approval/reject routing, `human.input` + `PAUSED_INPUT`, manual edit, resume,
  full action matrix (§12.4).
- **5 Media**: image/speech/video provider adapters, `media.analyze` probe +
  alignment, media manifests, ffprobe. "The real test of genericity."
- **6 Assembly**: `video.concat`, timeline schema, styles registry, built-in
  timeline checks, `timeline.render` via ComputeJobService.
- **7 Iteration**: `iterate`, sequential loop, `prevItem` carry, per-item retry,
  partial resume. "Where the money protection becomes real."
- **8 Characters**: channel Character assets, reference upload/promotion,
  readiness gate, explicit blueprint reference selection, and immutable
  run snapshots. LoRA is deliberately deferred.
- **9 Editor & templates**: capability-resolved forms, schema editor,
  script-check tester, template library, dry-run.
- **9.5 Visual graph canvas** (not in the original design spec — split out of
  Phase 9 by explicit product decision): a drag/drop stage-graph editor
  (nodes, edges, reordering) built on top of Phase 9's APIs
  (`/capabilities/:key/resolve`, `/blueprints/:id/validate`, the template
  library, dry-run). Phase 9 deliberately kept the blueprint graph itself
  JSON-authored; this phase is where a real canvas replaces that.
- **10 Live updates (Socket.IO)** (not in the original design spec):
  replace/extend the current SSE-based run-progress feed
  (`apps/api/src/orchestration/run-events.ts`'s `InProcessRunEvents`, §21.2)
  with Socket.IO, and push live updates wherever else the UI would benefit
  — run/stage state transitions, dry-run progress, budget changes, and any
  other spot polling currently stands in. Note this is a different swap
  than §21.2 originally anticipated (it names Postgres LISTEN/NOTIFY or
  Redis pub/sub as the eventual backend behind the same `RunEvents`
  interface for multi-replica correctness, not a client-transport change
  from SSE to WebSockets) — reconcile the two when this phase is planned.

Update this table's Status/Plan/PR columns as work lands; keep it in sync
with the actual state of `main`, not aspirational.
