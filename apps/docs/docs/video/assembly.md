---
title: Assembly
description: The two ways to turn clips, images, voice-over and captions into a finished video.
---

The last part of most blueprints is **assembly**: putting the pieces together into one video. Reelcraft
has two stage types for it, and both run on your own computer for free.

## Concatenate Video

[Concatenate Video](../stage-types/concatenate-video.md) joins clips end to end, with an optional
crossfade, a replacement voice-over or music, and burned-in subtitles.

Choose it when:

- every clip is already the right video;
- you only need them in order, with sound on top;
- you want the simplest, fastest setup.

## Render Timeline

[Render Timeline](../stage-types/render-timeline.md) draws a [timeline](./timelines.md): a plan with
several tracks, where clips, still images, music, titles and animated captions can overlap.

Choose it when you need:

- titles, lower thirds or **styled captions** on top of the picture;
- images with motion, such as a slow zoom;
- transitions, fades and volume control;
- to place everything precisely, or edit it yourself.

The timeline can come from three places:

- a [Generate Text](../stage-types/generate-text.md) stage with a `timeline` output, where a model plans
  the edit;
- [Human Timeline Edit](../stage-types/human-timeline-edit.md), where you edit it in the
  [timeline editor](./timeline-editor.md);
- both: a model drafts it, and you polish it.

## Which video becomes the final video

The finished video shown at the top of a run is the output of the **last stage, in blueprint order,
that made a video**. So end the blueprint with the stage that makes the finished video. See
[Outputs and downloads](../runs/outputs-and-downloads.md#the-final-video).

## A typical shape

1. A model writes a script and a plan, with one scene per entry.
2. Scene images or clips are made, one per scene.
3. A voice-over is made from the script.
4. [Analyze Media](../stage-types/analyze-media.md) gets word timings from the voice-over, for captions.
5. A timeline puts them together, and [timeline checks](./timeline-checks.md) catch mistakes.
6. **Render Timeline** makes the video, followed by [human approval](../blueprints/iterate-conditions-approval.md#human-approval).
