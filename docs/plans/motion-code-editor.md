# Edit a motion graphic's code, with a preview

## Why

A motion graphic is code a model wrote. When it is almost right (a wrong colour, a number, a timing), the
only fix today is to run the stage again and hope. A person who can read code should be able to change it,
see it, and keep it, without leaving the run.

## What

On a run, a Generate Motion Graphic output (any `data` artifact in the MotionSource shape) shows **Edit code**
under its preview. The dialog has:

- the code, in a monospace editor, with the size, frame rate, length and background next to it, and the
  length editable;
- the rule check as you type (debounced): every problem from `checkMotionCode`, with its line;
- **Render preview**: renders pictures of the start, middle and end through the render worker
  (`motion --stills`), with the graphic's own files, and shows them when they are ready;
- **Save**: replaces the stage's output with the edited graphic through the existing manual edit
  (`POST /runs/:id/stages/:key/artifact`, preview then confirm). The preview lists the later stages that will
  run again (Render Motion Graphic, Compose Timeline, ...), as for any manual edit; the old artifact goes
  stale in the same transaction.

### API

- `POST /runs/:id/stages/:key/motion/check` `{ code }` -> `{ issues }`.
- `POST /runs/:id/stages/:key/motion/preview` `{ source }` -> `{ preview }` (`rendering`, or `invalid` with
  issues when the code breaks a rule).
- `GET /runs/:id/stages/:key/motion/preview/:previewId` -> `{ preview }` (`rendering`, `done` with three PNG
  data URLs, `failed` with the error, `expired`).

`MotionEditorService` (run module) checks the stage belongs to the run, resolves the graphic's files with
`TimelineResourceResolverService.resolveHandles`, spawns `motionRenderSpec({ stills: true })` through
`ComputeJobService`, and keeps the preview jobs in memory (a preview is a convenience: after an API restart
it reads as `expired` and is rendered again). Finished jobs are removed when read, and the compute reaper
removes abandoned ones.

## Not in scope

Syntax highlighting or a code editor library, a live in-browser player (the code would have to be bundled),
editing the props in a form.
