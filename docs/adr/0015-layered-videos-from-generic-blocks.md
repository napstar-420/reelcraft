# ADR 0015: Layered videos are built from generic blocks, not from a style

- Status: accepted
- Date: 2026-10-15

## Context

We wanted to make whiteboard explainers (lines that draw themselves on, words written out, a camera over one
big canvas, sounds as things appear). The first design recreated that one video: scene templates, a
whiteboard theme registry, a compiler from a scene plan, a rule table that picked sounds, and a special
namespace for built-in sounds. It worked for one look and for nothing else, and every other video style
would have needed its own compiler.

Reelcraft is a generic video creator. A whiteboard video is a background (a colour or an image), drawings
(SVGs placed at a position and size, appearing at a time), sounds (audio placed on the timeline), words and
captions. Any video is some mix of text, images, clips, drawings, sounds and motion.

## Decision

Build only generic blocks that combine into any video, and make a style a recipe made of them.

- **The timeline is the common language.** Any number of tracks of any type. Items are placed with
  position, size, rotation, order, an arrival animation and keyframes. A `media` item (picture, clip, sound)
  fills the frame, or sits in a box (`x`, `y`, `w`, `h`). A `graphic` item (its first name was `sketch`,
  which old timelines still use) draws lines from any SVG drawing, words in any font, or a shape. The canvas
  has a background colour. A timeline can have a world, a camera and a theme. Nothing in the schema names a
  look.
- **One composer.** `timeline.compose` takes a plan of layers (what, where as fractions of the frame, when
  as seconds or spoken words, how it arrives) and an assets input, checks the plan against the assets,
  does the arithmetic and writes the timeline. It makes no creative choices; a model or a person writes the
  plan. Every problem is reported at once so a retry can fix them together. Whiteboard, slideshow and
  short-with-captions are different plans, not different stages.
- **One asset model.** Pictures, clips, voice-over, music, sound effects, drawings and fonts are assets of
  a kind. Each kind can be made during the run (an image, speech, music or sound-effect stage, or a model
  drawing SVG path data that `svg.prepare` checks) or uploaded to the channel library. A catalogue
  (`AssetCatalog`) lists assets of any kind and source the same way. The `library` ref hands a stage the
  catalogue of the channel's uploaded assets (snapshotted at run start, like `asset` refs) plus the built-in
  ones, so a plan can pick only from what was uploaded, or from everything, or mix with generated assets.
  Compose refuses an id that isn't in the catalogue.
- **Built-in assets are ordinary library assets.** The built-in drawings and sounds are listed in the library
  catalogue like uploads. Built-in sounds use handles `builtin:audio/<id>`; their files ship with the
  composition, so previews and renders play the same thing.
- **Drawings are uploadable.** An asset kind `vector` stores an SVG file; it is read at upload (paths,
  shapes, transforms, colours) into the same line format a model's drawing uses, and refused if it can't be
  drawn or has scripts.
- **Everything is a pure function of the frame.** Animation, camera and wobble come from pure functions of
  time and a seed; no `Math.random`, no clock. The editor preview and the render share one composition, so
  they draw the same pixels and rendering twice gives the same frames.
- **Draw-on uses `@remotion/paths`, and no SVG filters.** Lengths are measured in JavaScript so they are the
  same everywhere. The paper is a CSS gradient.
- **Version 2 only when needed.** A timeline that uses a world, camera, theme, graphic, placed media or
  reveal is written as `version: 2`, set by the parse. An older release rejects it rather than silently
  dropping what it doesn't know, which matters because the in-app updater can roll back.
- **Motion graphics are the next block.** A stage where a model (Codex or Claude with a Remotion skill)
  writes motion for what a video needs and returns it as data or a rendered clip to place on the timeline
  will cover what no fixed item can. It is not part of this decision.

## Consequences

- Timelines have a second version. Anything that writes one should let `Timeline.parse` set it.
- The timeline editor shows graphic items and placed media but cannot yet edit their lines.
- Remotion is licensed by company size; a larger company using it to render needs its own licence.
- Because plans are checked against a catalogue, "use only my uploaded assets" is enforced by the stage,
  not just asked of the model.

## Alternatives

- **A style-specific compiler (scene templates and a whiteboard theme):** what we first built. It makes one
  look and needs another compiler for the next. Rejected for that reason (see CLAUDE.md, "Design
  Principle: Generic Building Blocks").
- **A model writes timeline JSON directly:** possible, but it can't see the asset ids, can't convert spoken
  words to times, and can't be checked until render. A plan plus a deterministic composer gives it the same
  freedom with checks.
- **Vector assets embedded only in a run:** drawings that live in the run can't be reused or uploaded; the
  library and the `vector` kind make them reusable.
- **Lottie:** an animation format, not a way for a model to write drawings, and it brings its own player.
