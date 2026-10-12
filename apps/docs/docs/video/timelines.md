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

- **Media**: a clip, image or sound, with a start time and a duration.
- **Text**: words on screen, with a style and a position.
- **Captions**: the words of a voice-over, timed to the speech, with a style.

An item must be on a suitable track: text on an overlay track, captions on a captions track.

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

## Ducking

An audio track can be set to **duck under** another track: while the other track has something playing, its
volume drops to about a third, so music gets quieter under a voice-over. This is part of the timeline
itself and isn't set in the editor, so ask the model that writes the timeline to do it, for example "keep
the music track quiet under the voice track".

## Checks

Before a timeline is accepted, Reelcraft checks it. See [Timeline checks](./timeline-checks.md).
