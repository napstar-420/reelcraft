---
title: Render Motion Graphic
description: Render a motion graphic's code into a video clip, transparent or not, to place on a timeline.
---

**Render Motion Graphic** turns a motion graphic, the code that [Generate Motion Graphic](./generate-motion-graphic.md)
writes, into a video clip. It runs inside Reelcraft, so it's free.

## What it makes

A `media.video` clip, with no sound:

- a **transparent** graphic becomes a WebM with see-through parts, so whatever is under it on the
  timeline shows through;
- an **opaque** graphic becomes an ordinary MP4.

Place the clip with [Compose Timeline](./compose-timeline.md), like any other video: full frame, or in a box with
its own position, size and arrival. When the stage iterates, each clip is named after the input it is bound
to: `graphics-1`, `graphics-2` and so on.

## Inputs

- **`source`** (required): the motion graphic, usually the output of Generate Motion Graphic.

## Before it renders

The code is checked again against the motion graphic rules. Code that breaks one is not run, and the stage
fails with every problem listed. The code may only use Remotion's own packages and React; a render that asks
for anything else stops.

## Cost

Free. It uses your computer's processor and some time: a few seconds to a minute, depending on the size and
length.

## If it fails

The stage log shows the error from the graphic, such as a mistake that only shows when it runs. Run the
Generate Motion Graphic stage again, or edit its output and run this stage again.
