# Phase 6 — Assembly and timeline editing

Phase 6 adds two paths to an assembled video: a compact FFmpeg-based
`video.concat` capability and a full `timeline.render` capability backed by a
shared Remotion composition. `subtitles.export` creates SRT or WebVTT sidecars.

The timeline is an engine-owned artifact with canonical media handles,
registered text/caption styles, and automatic handle, style, source-bound,
coverage, A/V alignment, and canvas checks. A `human.timeline_edit` stage parks
the run and opens a browser editor with preview, track and property editing,
undo/redo, durable autosave, revision conflict detection, and submission through
the normal human-action transaction.

Long renders execute in durable compute-job directories. Inputs are copied from
object storage before spawn, the supervisor survives API restarts, submissions
are idempotent, outputs are persisted before workspace cleanup, and missing
supervisors consume the separate infrastructure retry allowance rather than a
semantic retry.

## Local render acceptance

Install FFmpeg (including `ffprobe`) and Chrome/Chromium, then install workspace
dependencies and run:

```sh
pnpm install
pnpm --filter @reefcraft/api acceptance:phase6-render
```

Set `REMOTION_BROWSER_EXECUTABLE` when Chromium is not discoverable. The command
creates a synthetic uploaded-input clip, renders it with a title through the
same worker used by `timeline.render`, probes the result, and verifies its
duration and non-empty output. This local exercise is intentionally excluded
from CI because it depends on system FFmpeg and a browser.
