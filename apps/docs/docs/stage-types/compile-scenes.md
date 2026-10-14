---
title: Compile Scenes
description: Turn a scene plan into a hand-drawn video timeline, timed to the voice-over.
---

**Compile Scenes** puts a hand-drawn (whiteboard) video together from a **scene plan**. It decides where each
drawing goes and when it is drawn, and moves a camera from scene to scene. It runs inside Reelcraft, so it's
free and instant.

You don't tell it where anything goes. A model writes the plan, which scenes there are, which **layout** each
uses, what goes in each place and what is said, and this stage does the rest. Because layouts come from
templates and times come from the voice-over, a plan can't put a drawing off the screen or on top of another.

## What it makes

A `timeline` output, for [Render Timeline](./render-timeline.md). See
[Hand-drawn videos](../video/timelines.md#hand-drawn-videos).

## Inputs

- **`scenes`** (required): the scene plan, as `data`. See [The scene plan](#the-scene-plan).
- **`voice`** (optional): the voice-over, from [Generate Speech](./generate-speech.md). It is played under the
  video, and its length is the video's length.
- **`timing`** (optional): the voice-over's word timings. With them, each scene starts when its words are
  spoken, and each drawing appears at the words you cue it with. Without them, scenes last as long as their
  words take to read. With ElevenLabs, turn on **Word timings** and write them to memory with a
  `writes` entry at the path `timing`, then bind that memory here. Or use
  [Analyze Media](./analyze-media.md).
- **`assets`** (optional): drawings made for this video. A plan can name a built-in drawing, or one made
  for the run.

## The scene plan

A plan has a **title** and a list of **scenes**. Each scene has:

- a **template**: its layout,
- the **narration**: what is said while it is on screen (the narration of all scenes, in order, is the script),
- a **title**, for a `title` scene and optional on the others,
- **slots**: what goes in each place of the layout.

| Template               | Layout                                                        | Slots                        |
| ---------------------- | ------------------------------------------------------------- | ---------------------------- |
| `title`                | A big title with an underline, a subtitle and one drawing     | `main`, `subtitle`           |
| `three_step`           | Three things in order, with arrows between them               | `step1`, `step2`, `step3`    |
| `before_after`         | Two things side by side, with an arrow                        | `before`, `after`            |
| `cause_process_result` | A cause, what happens and the result, with arrows             | `cause`, `process`, `result` |
| `problem_why_solution` | A problem, why it happens, and the fix, with arrows           | `problem`, `why`, `solution` |
| `free`                 | Any places you name, each with a box (fractions of the scene) | your own                     |

A slot has a **drawing** (`asset`, by id), **text** (words written with it), an optional **heading**, an
**emphasis** (`circle`, `underline` or `highlight` on the words) and a **cue**: words from the narration, such
as "first comes the cue", that bring it in. A wide frame lays a sequence out in a row, a tall one in a column.

Drawings are named by id: one of the built-in drawings (such as `lightbulb`, `arrow-right`, `brain`,
`coffee-mug`, `trophy`, `person-celebrating`), or one made for the run. If a drawing can't be found, the
plan's fallback or the closest built-in drawing is used, and the stage log says so.

## Settings

Under **Config**:

- **aspectRatio**: `16:9` or `9:16`. Defaults to your channel's [format](../channels/defaults.md#format), then `16:9`.
- **resolution**: `720p` or `1080p` (default).
- **fps**: 12 to 60 (default 30, or your channel's).
- **theme**: `whiteboard` (default, dark ink on white paper), `blueprint` (blue ink on grid paper) or
  `chalkboard` (chalk on a dark board).
- **hand**: `marker` (default), `pencil` or `none`: a pen that follows the line as it is drawn.
- **captions**: show the voice-over as captions. Needs word timings.
- **captionStyle**: a [caption template](../video/timeline-editor.md#captions). Default **Clean**.

## Cost

Free.

## If it stops

The stage stops without retrying, with a message, if the plan isn't valid (for example a slot the template
doesn't have), if the timing or drawings aren't the right shape, or if there are too many scenes to fit on one
canvas. Words too long for their place, a cue not found in the narration and a missing drawing don't stop it:
they are listed in the stage log.

## Tips

- Put the voice-over before this stage, so the drawing follows it. Generate Speech, then this stage, then
  [Render Timeline](./render-timeline.md).
- Keep words short: a few per place. Long words shrink to fit.
- Use `camera: wide` on the last scene to pull back and show everything drawn.
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) after the render.
