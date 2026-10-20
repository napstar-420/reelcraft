# Motion graphics embedded in the timeline

## Why

A motion graphic reaches a video today as a rendered clip (Render Motion Graphic). That costs a render per
graphic, fixes the graphic's pixels before the final render, and a transparent WebM is decoded again in the
final render. ADR 0017 deferred the other way: the code goes into the timeline and is drawn by the final
render itself, at the timeline's own resolution, with no clip in between.

## What

- **Timeline item `motion`** (overlay tracks, version 2): `startSec`, `durationSec`, the graphic's own
  `width`/`height`, `code`, optional `props`, `files` (`{ name, handle }`, loaded with `staticFile(name)`),
  `notes`, and an optional box (`x`, `y`, `w`, `h`, `rotate`, `z`) on the screen; without a box it fills the
  frame. The graphic runs at the timeline's frame rate.
- **Composition.** A `motion` item is drawn by a component from a `MotionComponents` context, inside a
  `<Sequence width height durationInFrames>` (so `useVideoConfig()` inside the code reports the graphic's own
  size and length), scaled into its box. Without a component (the editor's browser preview, which can't
  bundle code) it shows a labelled placeholder with the notes.
- **Final render.** When a timeline has motion items, the render worker writes each item's code to its own
  file, generates a root that registers the timeline composition with those components, and bundles it with
  the same import allowlist as the `motion` mode (packages resolve from the render worker). Timelines without
  motion items bundle exactly as before. Files a graphic loads are copied in under their own names; two
  graphics that load different files under one name are refused.
- **Checks.** `timeline.motion_code` fails when an item's code breaks the motion rules (`checkMotionCode`); the
  files resolve like any handle.
- **Compose Timeline.** A plan layer `{ kind: 'motion', asset }` names a motion graphic from the assets (a
  Generate Motion Graphic output bound as an input or in `assets`, catalogue kind `motion`); compose embeds it
  with the layer's box and time (or its own length).
- **Editor.** Motion items show in the lanes as "Motion graphic" with their notes; start and length can be
  edited like any item.
- **Docs.** Timelines (motion items), Compose Timeline (`motion` layers), Generate Motion Graphic (embed or
  render), ADR 0017 addendum.

## Not in scope

World-space motion items under the camera, previewing embedded code in the browser editor, keyframes and
arrivals on motion items (the code animates itself).
