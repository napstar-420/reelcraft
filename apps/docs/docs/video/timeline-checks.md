---
title: Timeline checks
description: The seven automatic checks every timeline goes through, and how to fix each one.
---

Whenever a stage makes a timeline, or you submit one from the [editor](./timeline-editor.md), Reelcraft
runs seven checks on it. They catch mistakes before the video is rendered, which saves time and money. All
seven are shown for every timeline, so you can see which pass.

| Check                       | Fails when                                                              |
| --------------------------- | ----------------------------------------------------------------------- |
| `timeline.schema`           | The timeline isn't valid at all, for example a missing field or an item on the wrong kind of track |
| `timeline.handles_resolve`  | An item refers to a file that doesn't exist, was replaced or was deleted |
| `timeline.styles_exist`     | A text or captions item uses a style Reelcraft doesn't have             |
| `timeline.source_bounds`    | An item asks for more of a file than the file has                       |
| `timeline.coverage`         | The main video track has gaps with nothing in them                      |
| `timeline.av_alignment`     | The audio and the video end at noticeably different times               |
| `timeline.canvas_match`     | The timeline's shape doesn't match the aspect ratio you asked for       |

If the schema check fails, only it is reported, since the others can't be worked out.

## How to fix each

### timeline.schema

The message names the exact spot, such as `tracks.0.items.1.durationSec: Too small`. In the editor, correct
that item. If a model wrote the timeline, add the rule to its prompt.

### timeline.handles_resolve

A clip or audio file the timeline uses is **missing, stale or deleted**, or isn't one of the files the stage
was given. Re-run the stage that makes the file, or remove the item. A stale file means the stage that
produced it was redone after the timeline was written, so redo the timeline too.

### timeline.styles_exist

The message lists the unknown styles. Use one of the four: **Title**, **Minimal Lower Third**, **Bold Pop**
or **Clean Captions**. See [Timelines](./timelines.md#text-and-styles).

### timeline.source_bounds

An item asks for, say, 8 seconds from a 5-second clip. Shorten the item, trim less from the start, or set it
to **Loop it**, **Hold the last frame** or **Slow it down to fit**, which are allowed to run past the end.

### timeline.coverage

There's a gap between clips on the main video track. Move the clips together or fill the gap. If gaps are
intentional, turn on **allowGaps** in the [Human Timeline Edit](../stage-types/human-timeline-edit.md)
stage's settings.

### timeline.av_alignment

The audio and video end more than a quarter of a second apart. Trim or extend one to match the other, or
raise **toleranceSec** on the stage. It only applies when the timeline has both video and audio.

### timeline.canvas_match

The canvas shape, such as 1920 × 1080, doesn't match the aspect ratio set in your
[format defaults](../channels/defaults.md#format), such as 9:16. Change the canvas size, or the default.
This check only runs when an aspect ratio is set.

## Where you see the results

- In the **editor**, a failed submit lists the failures in a red box.
- On a **Generate Text** stage with a timeline output, failures count as failed
  [checks](../blueprints/checks.md): the stage tries again with the messages as feedback.
- In the stage's **Attempts**, each check shows with its message.
