# Timeline layout checks

## Why

A model places pictures, drawings, words and motion clips on a timeline (Compose Timeline). Nothing checks
that the result reads well: words can sit off the frame, two captions can land on top of each other, a
drawing can flash past in a few frames, or words can be too small to read on a phone. People find out only
after rendering.

## What

Five layout rules, run with the other timeline checks (after Compose Timeline, Human Timeline Edit, and on
every edit in the timeline editor). They are **advice**: a passing result with `warning: true`, a message
and the items it is about. Advice never fails a stage or blocks a submit, because layouts are a judgement
call and existing blueprints must keep running.

| Rule                     | Looks at                                | Advice when                                                                |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------- |
| `timeline.on_screen`     | placed items (graphics, media in a box) | less than 90% of its box is inside the frame (screen) or the world (world) |
| `timeline.text_overlap`  | words (graphic text) at the same time   | two boxes cover more than 20% of the smaller one for more than 0.2 s       |
| `timeline.min_on_screen` | placed visuals                          | shown for less than 1 s                                                    |
| `timeline.text_size`     | graphic text                            | letters smaller than 2.5% of the frame's short side, as seen on screen     |
| `timeline.safe_area`     | graphic text on the screen              | its box comes within 4% of the frame's edge                                |

World-space sizes are scaled the way they are seen: by the camera's smallest zoom when there is a camera,
else by how the world fits the frame.

## Where

- `apps/api/src/check/timeline-layout.ts`: pure function `layoutAdvice(timeline)`, unit tested.
- `TimelineCheckService.run` appends its results.
- `CheckResult.warning`, `TimelineCheckResultDto.warning`.
- Web: `check-issues.ts` turns warnings into advice; the checks indicator shows problems and advice
  separately ("2 problems · 3 tips"), and items marked with advice get their own note.
- Docs: timeline editor page and validation reference list the rules.

## Not in scope

Failing a stage on layout (a later option per stage), checks on the plan before compose, contrast and
colour checks.
