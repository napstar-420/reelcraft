---
title: Timelines
description: What a timeline is made of, and the styles, motion and transitions you can use in it.
---

A **timeline** is a plan for a video: how big it is, and which clips, images, sounds, titles and captions
appear at which moments. [Render Timeline](../stage-types/render-timeline.md) turns it into a video.

You don't have to write one by hand. A model can draft it, and you can adjust it in the
[timeline editor](./timeline-editor.md).

## The canvas

The **canvas** is the picture's size and speed: width and height in pixels, and frames per second, for
example 1080 × 1920 at 30. Your channel's [format default](../channels/defaults.md#format) sets these for
timelines made in the editor. The canvas can also have a background colour.

## Tracks and items

A timeline has **tracks**, like layers. Each track holds **items** that start at a time and last for a
while.

| Track type   | Holds                                                   |
| ------------ | ------------------------------------------------------- |
| **video**    | Clips and images that make up the main picture          |
| **audio**    | Voice-over and music                                    |
| **overlay**  | Titles and other text, and clips or images drawn on top |
| **captions** | Captions that follow the speech                         |

The items:

- **Media**: a clip, image or sound, with a start time and a duration. It can fill the frame, or be placed
  in a box. See [Place things on the frame](#place-things-on-the-frame).
- **Text**: words on screen, with a style and a position.
- **Captions**: the words of a voice-over, timed to the speech, with a style.
- **Graphic**: something drawn on the screen: lines from an SVG drawing, written words in any font, or a
  shape, with an animation. See [Graphics](#graphics).

A timeline can have any number of tracks of any type: several audio tracks (voice, music, sound
effects), several overlay tracks, several caption tracks. An item must be on a suitable track: text and
graphics on an overlay track, captions on a captions track, and a sound on an audio track.

## Media items

A media item can have:

- **Trim in**: where in the source file to start.
- **Fit** (images and video): **Cover** fills the frame and crops the edges, **Contain** shows all of it
  with bars, **Fill** stretches it.
- **If the source is shorter** than the time you gave it: **Stop at its end (trim)**, **Loop it**,
  **Hold the last frame**, or **Slow it down to fit**.
- **Volume**: from 0 to 2, where 1 is the original.
- **Fade in** and **Fade out**: in seconds. Together they can't be longer than the item.
- **Motion**: **Ken Burns (zoom and drift)**, **Zoom in** or **Pan**, with a **strength**.
  Ken Burns combines a slow zoom with a gentle drift, and the direction changes from clip to clip so a run
  of images doesn't all move the same way.
- **Transition in** and **Transition out**: how it arrives and how it leaves: **Crossfade**, **Slide** or
  **Wipe**, each with a length. A crossfade fades the picture in from nothing, or out to nothing; a slide
  comes in from the right and leaves to the left; a wipe reveals it from the left and hides it from the
  left. Clips don't overlap, so what shows behind a transition is the canvas background.

## Text and styles

Text looks the way its **style** says. Reelcraft has two for text:

| Style                   | Looks like                                               |
| ----------------------- | -------------------------------------------------------- |
| **Title**               | Large centred white text with a soft shadow              |
| **Minimal Lower Third** | A dark band with left-aligned text, for names and labels |

Captions use a **caption template**: a whole look that also says how the spoken word stands out, how many
words show at once and where they sit. There are thirteen, from **Clean** and **Bold Pop** to **Karaoke**,
**Neon**, **Cinema** and **Newsroom**. See [Timeline editor](./timeline-editor.md#captions) for the list.

A text item also has a **position**: **Top**, **Center** or **Bottom**.

## Captions

A captions item shows the words of a voice-over as it plays, in time with the speech. It uses the word
timings from [Analyze Media](../stage-types/analyze-media.md), so you can't change what is said or when
in the editor, only the style.

## Place things on the frame

A media item fills the frame unless it has a **box**: **x**, **y**, **w** and **h**, in the units of its
space (the frame's pixels on the screen). With a box, a picture or clip sits where you put it, at the size
you give, and can be **rotated** and given a **z** order. It can also have an **animation** (**pop**,
**fade**, **slide** or **none**) and **keyframes**, like a graphic. A sound can't have a box. This is how a
logo goes in a corner, a photo sits beside some words, or a clip plays in a smaller frame.

## Graphics

A **graphic** item draws something on the screen with an animation. It works for any look: hand-drawn,
clean and flat, or anywhere in between. [Compose Timeline](../stage-types/compose-timeline.md) places them
from a plan, so you normally don't write them by hand. A graphic draws one of three things:

- **Lines**: any shape, as lines drawn in order. A drawing is a list of strokes on a grid you choose; it can
  come from an SVG file or a [drawing a model made](../stage-types/prepare-drawings.md).
- **Words**: text in any font family, weight and alignment, or in the theme's two fonts (**hand** and
  **body**). The words can be in parts, each with its own colour, font or weight, to pick out a word in a
  line.
- **A shape**: an **arrow**, **circle**, **underline**, **box**, **highlight** (a marker swipe) or **check**.

How it appears is its **animation**:

| Animation     | What it does                                                                        |
| ------------- | ----------------------------------------------------------------------------------- |
| **Draw**      | Lines are drawn on one after another; a filled shape fills in once its line is done |
| **Handwrite** | Words are written out from left to right                                            |
| **Pop**       | Grows a little past full size, then settles                                         |
| **Fade**      | Fades in                                                                            |
| **Slide**     | Slides in from the left, right, top or bottom                                       |
| **Highlight** | A marker swipes behind the item                                                     |
| **None**      | Is there from the start                                                             |

Draw and handwrite can show a **pen** or **marker** that follows the line. Each animation has its own pace,
or you can give a length in seconds. An item can also have a few **keyframes** after it appears: where it is,
how big, turned and how visible, at moments you choose, which blend between.

A timeline can also have a **world** (a canvas bigger than the picture) with a **camera** that moves over
it, and a **theme**: the paper, ink, colours and fonts that drawn lines and words use. A **background**
colour sits behind everything; use a picture on the video track for anything fancier.

Lines can be drawn slightly wobbly, like a hand would, and the wobble is the same every time, so a video
looks the same each time you render it. The theme's **roughness** sets how wobbly, and 0 is clean.

### The world and the camera

Items can sit **on the world** or **on the screen**. Items on the world move with the camera, and items on the
screen stay where they are. The camera is a list of moments (**keys**), each with the point of the world it
looks at and how close it is: **1** shows a part of the world as big as the picture, **2** is twice as
close and **0.5** twice as far. Between two keys the camera glides, and zooming feels even. With no camera,
the whole world is shown. Captions are always on the screen.

### Pictures that draw in

A **media** item that is an image can have a **reveal**, so it looks as if it is being drawn in: **wipe** from
the left, a **circle** growing from the middle, or a **marker** swipe with a soft edge.

### Motion graphics

A **motion graphic** item carries a graphic's own code (from
[Generate Motion Graphic](../stage-types/generate-motion-graphic.md)), its size, the data it is given and the
files it loads. The final render draws it from its code, on an overlay track, in its box on the screen or over
the whole frame. The editor's preview can't run the code, so it shows a placeholder card with the graphic's
description; **Draft render** shows the real thing. The code is checked like any motion graphic
(`timeline.motion_code`).

### Version

A timeline can list **fonts**: each a family name and the library font file it loads from. Words name the
family, and the file is loaded before the first frame, in the editor's preview and in the render.

A timeline that uses a world, camera, theme, fonts, graphic, motion graphic, placed media or reveal is saved as **version 2**. An
older release refuses to open it, instead of quietly dropping them. Timelines that use none of these stay
version 1. Timelines saved when graphics were called _sketch_ items still open.

### Built-in sounds

A media item can name a **built-in sound** instead of a file: `builtin:audio/pop`. These sounds ship with
Reelcraft, so they need no stage, no upload and no cost, and they play in the editor and in every render. In
the [asset library](../channels/assets.md#the-library) they are ordinary audio assets that happen to come
with Reelcraft, so a plan picks them the same way it picks a sound you uploaded.

| Name      | Sound                                  |
| --------- | -------------------------------------- |
| `pencil`  | Short scratches of a pencil on paper   |
| `marker`  | The squeak of a marker writing         |
| `pop`     | A soft bubble pop                      |
| `whoosh`  | Air moving past, rising and fading     |
| `paper`   | Paper being moved                      |
| `click`   | A small click                          |
| `ding`    | A bright bell ding, for a right answer |
| `tick`    | A clock tick                           |
| `swipe`   | A quick swipe, high to low             |
| `sparkle` | A glittering run of high notes         |
| `thud`    | A soft thump, for something landing    |
| `chime`   | A gentle two-note chime, for a result  |

Make others with [Generate Sound Effect](../stage-types/generate-sound-effect.md), or upload your own.

## Ducking

An audio track can be set to **duck under** another track: while the other track has something playing, its
volume drops to about a third, so music gets quieter under a voice-over. This is part of the timeline
itself and isn't set in the editor, so ask the model that writes the timeline to do it, for example "keep
the music track quiet under the voice track".

## Checks

Before a timeline is accepted, Reelcraft checks it. See [Timeline checks](./timeline-checks.md).
