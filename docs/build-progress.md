# Reefcraft Build Progress

Tracks design-spec §24 Build Order phases. Each phase gets its own detailed
plan (via `/plan`) written just before it starts — this table is the index.

| #   | Phase                  | Status            | Plan                                     | PR(s)                  |
| --- | ---------------------- | ----------------- | ---------------------------------------- | ---------------------- |
| 1   | Skeleton               | done              | —                                        | (initial commit)       |
| 2   | Core loop              | done              | `.claude/plans/crispy-drifting-cocke.md` | #1, #4, #5, #6, #7, #8 |
| 3   | Budget                 | done              | `.claude/plans/phase-3-budget-*.md`      | #9, #10                |
| 4   | Inputs & human-in-loop | done (chunks 1–7) | `.claude/plans/phase-4-inputs-hitl.md`   | #11, #12, #13          |
| 5   | Media                  | done              | —                                        | #14                    |
| 6   | Assembly               | done              | `docs/plans/phase-6-assembly.md`         | current branch         |
| 7   | Iteration              | planned           | `docs/plans/phase-7-iteration.md`        |                        |
| 8   | Characters             | pending           |                                          |                        |
| 9   | Editor & templates     | pending           |                                          |                        |

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
- **8 Characters**: character assets, reference upload/promotion, readiness
  gate, selection policy, LoRA job.
- **9 Editor & templates**: capability-resolved forms, schema editor,
  script-check tester, template library, dry-run.

Update this table's Status/Plan/PR columns as work lands; keep it in sync
with the actual state of `main`, not aspirational.
