---
title: Human Timeline Edit
description: Pause the run so you can arrange the clips, audio and text on a timeline by hand.
---

**Human Timeline Edit** stops the run and opens a timeline editor, so you can cut, trim and arrange the
pieces yourself. When you submit, the run continues with your timeline.

## What it makes

A `timeline` output.

## Inputs

All optional, but the stage needs at least one of `timeline`, `clips` or `images`:

- **`timeline`** (one): a timeline to start from, for example one a
  [Generate Text](./generate-text.md) stage wrote. You edit it rather than starting from scratch.
- **`clips`** (many videos), **`images`** (many images), **`audio`** (many audio files): the media
  you can use. When there's no starting timeline, Reelcraft lays the clips and images out one after
  another to begin with.
- **`captions`** (many objects): word timings, from [Analyze Media](./analyze-media.md), so you can add
  captions.

## Settings

Under **Config**:

- **allowGaps**: allow gaps in the main video track. By default, gaps fail the timeline checks.
- **toleranceSec**: how far apart the video and the audio may end, in seconds, before it's flagged.
  Default 0.25.

## How it works

1. When the run reaches the stage, it pauses as **Paused Input**.
2. On the run page, select **Open editor** on the stage.
3. Edit the timeline. See [Timeline editor](../video/timeline-editor.md).
4. Select **Submit timeline**. Reelcraft runs its [timeline checks](../video/timeline-checks.md); if
   any fail, you're shown which, and you stay in the editor to fix them.

No money is spent while the run waits.

## Tips

- A good pattern is to let a model draft the timeline, then use this stage to polish it.
- Follow it with [Render Timeline](./render-timeline.md).

## Example

"Edit timeline": `timeline` bound to the drafted timeline, `audio` bound to the voice-over, and
`captions` bound to the voice timings.
