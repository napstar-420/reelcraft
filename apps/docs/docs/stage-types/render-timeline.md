---
title: Render Timeline
description: Turn a timeline into a finished video, with styled text, captions, transitions and sound.
---

**Render Timeline** draws a [timeline](../video/timelines.md) into a real video file. It runs inside
Reelcraft, so it's free and needs no key.

A timeline is a plan: which clips and images appear when, which music plays under them, and which
text and captions are laid over the top. Rendering carries out the plan. For a plain join of clips,
[Concatenate Video](./concatenate-video.md) is simpler.

## What it makes

A single `media.video` output, an MP4 called `timeline.mp4`.

## Inputs

- **`timeline`** (required, one timeline): the plan to render. It usually comes from a
  [Generate Text](./generate-text.md) stage with a `timeline` output, or from
  [Human Timeline Edit](./human-timeline-edit.md).

Every clip, image and audio file the timeline mentions, and the word timings for any captions, are
found automatically from what earlier stages made. The render stops with an error if one is missing.

## Settings

Under **Config**:

- **quality**: `final` (the default) is the full-quality render. `draft` is faster and smaller, for
  checking a blueprint.
- **maxWaitSec**: how long to wait for the render, in seconds. Default 1800 (30 minutes).

## Cost

Free. It uses your computer's time: a long video can take several minutes.

## Tips

- Use `draft` while building, and switch to `final` when you're happy.
- Put [Human approval](../blueprints/iterate-conditions-approval.md#human-approval) after it, since
  a video can't be scored by [quality control](../blueprints/quality-control.md).
- The shape of the video comes from the timeline's canvas. Set a default
  [format](../channels/defaults.md#format) so timelines match your channel.

## Example

"Final render": `timeline` bound to the previous stage, **quality** `final`, with human approval.
