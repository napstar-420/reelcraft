---
title: Layered videos
description: How to make any video from pictures, drawings, words, sounds and captions placed on a timeline.
---

Reelcraft doesn't have a separate way to make each kind of video. Every video is a
[timeline](./timelines.md): tracks of things placed at times and places. A hand-drawn explainer, a slideshow
with music, a short with word-by-word captions and a data video are all the same ingredients, placed
differently. This page shows the ingredients and how the stages fit together.

## The ingredients

Every ingredient is an **asset** of some kind, and every kind can be **made during the run** or **uploaded to
your channel's library** and picked from there:

| Kind                  | Made during a run by                                                                                                                        | Or uploaded as    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Pictures              | [Generate Image](../stage-types/generate-image.md)                                                                                          | **Image**         |
| Clips                 | [Generate Video](../stage-types/generate-video.md), [Flow](../stage-types/generate-video-with-flow.md)                                      | **Video**         |
| Voice-over            | [Generate Speech](../stage-types/generate-speech.md)                                                                                        | **Audio**         |
| Background music      | [Generate Music](../stage-types/generate-music.md)                                                                                          | **Audio**         |
| Sound effects         | [Generate Sound Effect](../stage-types/generate-sound-effect.md); some are [built in](./timelines.md#built-in-sounds)                       | **Audio**         |
| Drawings (SVG)        | A model draws them, [Prepare Drawings](../stage-types/prepare-drawings.md) checks them; some are built in                                   | **Drawing (SVG)** |
| Motion graphics       | [Generate Motion Graphic](../stage-types/generate-motion-graphic.md), then [Render Motion Graphic](../stage-types/render-motion-graphic.md) | **Video**         |
| Any file from the web | [Automate Browser](../stage-types/automate-browser.md) downloads it                                                                         | -                 |

Words, shapes, captions and the camera need no asset: they are part of the plan.

## The stages

1. **Make or find the assets.** Generate them, or bind the **library** so a planning stage can see what you
   uploaded.
2. **Plan the layout.** A [Generate Text](../stage-types/generate-text.md) stage writes a plan: which asset goes
   where, and when it appears, by the words of the narration. Give it the catalogue of assets so it picks ids
   that exist. Tell it to pick only from the catalogue if you want only what you uploaded.
3. **[Compose Timeline](../stage-types/compose-timeline.md)** turns the plan into a timeline. It refuses an id
   that doesn't exist and says so, so a plan can't quietly use something that isn't there.
4. **[Render Timeline](../stage-types/render-timeline.md)** makes the video.

The look comes from the planning prompt and the theme, not from a special stage. To make a hand-drawn
whiteboard video, ask for a plain light background, drawings that are drawn on by hand, headlines written out
and a soft sound as each thing appears. To make something else, ask for something else.

## Motion graphics

Animated titles, charts, counters, diagrams, lower thirds and transitions are motion graphics. A model writes
each one as code from your description ([Generate Motion Graphic](../stage-types/generate-motion-graphic.md)),
and Reelcraft renders it into a clip ([Render Motion Graphic](../stage-types/render-motion-graphic.md)). A
transparent clip goes over other footage, and an opaque one fills the screen. The plan places the clips like
any other video. Ask the assistant for "a narrated video of animated charts about …" to start from a worked
blueprint.

## Two ways to get the same asset

- **Generated**: nothing needs to exist in advance. Each run draws its own pictures, makes its own music,
  and so on. Every run is different, and costs whatever the generators cost.
- **From the library**: you uploaded the drawings, sounds, music and pictures to use, and told the planning
  stage to pick only from them. Every run looks like your brand, and nothing is made.

You can mix them in one video: drawings made in the run, a sound effect from the built-in set, and your own
background music.

## Try it

Ask the assistant for "a hand-drawn explainer about …". It starts from a worked blueprint with these stages. See
[the assistant](../blueprints/assistant.md).
