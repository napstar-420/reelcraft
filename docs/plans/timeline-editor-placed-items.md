# Timeline editor: placed items, graphics and motion clips

## Why

Compose Timeline writes graphics (words, drawings, shapes) and media placed in a box, and motion graphics arrive
as clips placed the same way. The timeline editor shows these items but can't change them: there is no way
to move a box, change words, swap the font, change an arrival, or turn a full-frame clip into a picture-in-
picture. People have to re-run the plan for a typo.

## What

In the inspector, for a selected item:

- **Box** (graphics, and media placed in a box): X, Y, width, height (pixels of the frame or the world),
  rotation, layer (z), and **On the screen / In the world** (only when the timeline has a world).
- **Arrival**: kind (graphics: draw, handwrite, pop, fade, slide, highlight, none; media: pop, fade, slide,
  none), length, ease, slide direction, and the pen for drawn lines.
- **Words** (graphic text): the words, letter size, colour, font (the theme's hand and body fonts, the
  timeline's library fonts, or a family typed in), weight, alignment.
- **Drawing**: one colour for every line (or keep the drawing's own colours). **Shape**: which shape, colour.
- **Media**: **Place in a box** (centred, half the frame, on the screen) and **Fill the frame** (removes
  the box, arrival and keyframes).
- **Keyframes**: how many there are, and **Remove keyframes**.
- Items are named by what they are: graphics by their words or id in the inspector header, the lanes and the
  title.

All edits are pure functions in `apps/web/src/pages/timeline-editor/placement.ts`, unit tested; the
inspector calls them through the existing `update` (undo/redo work as for every edit). Values are clamped so
the timeline stays valid (sizes at least 1px, a media arrival only of the kinds media allows).

## Not in scope

Dragging boxes on the preview, editing keyframes one by one, editing drawing strokes, a motion-clip badge
(motion clips are ordinary placed video and use the same controls).
