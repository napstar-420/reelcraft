---
title: Concatenate Video
description: Join clips into one video, with a voice-over and burned-in subtitles if you want them.
---

**Concatenate Video** joins several clips end to end. It runs inside Reelcraft with FFmpeg, so it's
free and needs no key. For finer control over what's on screen, use
[Render Timeline](./render-timeline.md).

## What it makes

A single `media.video` output, an MP4 called `assembled.mp4`.

## Inputs

- **`clips`** (required, many videos): the clips, joined in the order given.
- **`audio`** (optional, one audio file): a voice-over or music. When connected, it **replaces** the
  clips' own sound, and the video ends when the shorter of video and audio ends.
- **`subtitles`** (optional, one subtitle file): captions, from
  [Export Subtitles](./export-subtitles.md).

Without an `audio` slot, the clips keep their own sound, as long as every clip has some.

## Settings

Under **Config**:

- **transition**: `cut` (the default) or `crossfade`.
- **transitionDurationSec**: the length of a crossfade, in seconds. Default 0.35.
- **burnSubtitles**: draw the `subtitles` onto the picture. Without it, the subtitle file is ignored.
- **maxWaitSec**: how long to wait for the job, in seconds. Default 900.
- **audioMode**: listed but currently has no effect. Connecting the `audio` slot is what replaces the
  sound.

With `crossfade`, the clips' own sound is dropped, so connect the `audio` slot if you want sound.

## Cost

Free.

## Tips

- The clips should have the same size and frame rate to avoid surprises.
- To pass the clips of a stage that [iterates](../blueprints/iterate-conditions-approval.md), save
  its output to [memory](../blueprints/connecting-stages.md#memory) with a **Memory write** of `$`,
  then bind `clips` to that memory key. It arrives as a list, in item order.
- This type only joins clips. To add text, overlays or captions styled to taste, use
  [Render Timeline](./render-timeline.md).

## Example

"Assemble": `clips` bound to the "Scene clip" memory key, `audio` bound to the "Voice-over", and
**transition** set to `crossfade`.
