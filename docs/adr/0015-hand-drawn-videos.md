# ADR 0015: Hand-drawn videos are drawn items on a world, under a camera

- Status: accepted
- Date: 2026-10-14

## Context

A timeline had three kinds of item: media, text and captions. Its only motion was a zoom or pan on a
clip. A whiteboard explainer needs lines that draw themselves on, words written out, shapes that pop in,
a marker swipe, and a camera that moves over one big canvas, all following the narration. Every run
should also draw its own pictures, not pick from a fixed set (see the plan for per-run vector assets).

## Decision

- **One drawing item, not five.** A `sketch` item draws lines, words or a built-in shape, and has an
  animation (`draw`, `handwrite`, `pop`, `fade`, `slide`, `highlight`, `none`). One item touches the
  schema, the composition and the editor once; separate `draw`, `highlight`, `pop` items would each touch
  all three. It holds no media handle, so the resolver, the handle service and the render's file staging
  are untouched.
- **The world and the camera belong to the timeline, not to an item.** `world` (a canvas bigger than the
  frame) and `camera` (keys: where it looks, how close) are optional top-level fields. A camera is a
  singleton, so it needs no track rules. Items on the `world` move with it; items on the `screen` and
  captions do not. With no camera the whole world is shown.
- **A theme is data in the timeline.** `theme` holds the paper, ink, accent colours, the two fonts, the
  line weight and the roughness. Drawings name colours by theme name (`ink`, `accent1`, ...), so one
  drawing takes on any theme, and the render needs nothing from the API.
- **Everything is a pure function of the frame.** Animation, camera and wobble come from pure functions
  of time and a seed; there is no `Math.random` and no clock. The editor preview and the final render
  share one composition, so they draw the same pixels, and rendering twice gives the same frames. The
  wobble is seeded from the item's `id`, or its track and position.
- **Draw-on uses `@remotion/paths`, and no SVG filters.** Lengths are measured in JavaScript, not in the
  DOM, so they are the same everywhere. Filters are slow in headless Chrome and are avoided; the paper is
  a CSS gradient.
- **The fonts ship with the app.** Caveat and Patrick Hand (SIL Open Font License, from `@fontsource`)
  are bundled into the composition and loaded with `@remotion/fonts`, so a render needs no network and
  the image does not change.
- **Version 2 only when needed.** A timeline that uses a world, camera, theme, drawing or picture reveal
  is written as `version: 2`, set by the parse itself. An older release rejects it rather than silently
  dropping what it doesn't know, which matters because the in-app updater can roll back.
- **Pictures can draw in.** A `media` item can have a `reveal` (`wipe_lr`, `circle`, `marker`), so a
  generated image can look sketched on when nothing could be drawn as lines.
- **A built-in set of drawings.** About sixty simple drawings (arrows, marks, objects, stick figures) are
  built in as plain data. They are the fallback for a drawing a run could not make, and the examples a
  drawing prompt shows a model.

## Consequences

- Timelines have a second version. Anything that writes one should let `Timeline.parse` set it.
- The timeline editor shows drawing items but cannot yet edit their lines.
- Remotion is licensed by company size; a larger company using it to render needs its own licence. This
  decision does not change that.

## Alternatives

- **A `scene` data model compiled at render time:** the render would need the compiler, and an edit in the
  editor would have nothing to edit. Compiling to timeline items keeps the editor and the render honest.
- **Vector assets as media files:** needs a new asset kind, sanitising at upload and a place to keep them.
  Drawings embedded in the timeline travel with it.
- **Lottie:** an animation format, not a way for a model to write drawings, and it brings its own player.
