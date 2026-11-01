---
title: Timeline checks
description: The nine automatic checks every timeline goes through, the layout tips, and how to fix each one.
---

Whenever a stage makes a timeline, or you submit one from the [editor](./timeline-editor.md), Reelcraft
runs nine checks on it. They catch mistakes before the video is rendered, which saves time and money. All
nine are shown for every timeline, so you can see which pass.

| Check                      | Fails when                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `timeline.schema`          | The timeline isn't valid at all, for example a missing field or an item on the wrong kind of track |
| `timeline.handles_resolve` | An item refers to a file that doesn't exist, was replaced or was deleted                           |
| `timeline.styles_exist`    | A text or captions item uses a style Reelcraft doesn't have                                        |
| `timeline.source_bounds`   | An item asks for more of a file than the file has                                                  |
| `timeline.coverage`        | The main video track has gaps with nothing in them                                                 |
| `timeline.av_alignment`    | The audio and the video end at noticeably different times                                          |
| `timeline.canvas_match`    | The timeline's shape doesn't match the aspect ratio you asked for                                  |
| `timeline.motion_code`     | A motion graphic's code uses something it may not, such as another package or the network          |
| `timeline.connectors`      | An arrow that joins two items can't reach one of them                                              |

If the schema check fails, only it is reported, since the others can't be worked out.

## Layout tips

Five more checks look at how the picture reads. They are **tips**: they never fail a stage or block a submit,
because a layout is a judgement call. They only look at things placed in a box (drawings, words and clips
placed by [Compose Timeline](../stage-types/compose-timeline.md)).

| Tip                      | Shows when                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `timeline.on_screen`     | More than a tenth of a placed item is outside the frame (or the world, for world items) |
| `timeline.text_overlap`  | Two pieces of words cover each other for more than 0.2 seconds                          |
| `timeline.min_on_screen` | A placed item shows for less than a second                                              |
| `timeline.text_size`     | Words are smaller than 2.5% of the frame's short side, as seen on screen                |
| `timeline.safe_area`     | Words come within 4% of the edge of the frame                                           |

Words placed in the world are measured as the camera shows them. If the layout came from a model, add the tip's
rule to the layout prompt; in the editor, move or resize the item.

## In the editor

The [timeline editor](./timeline-editor.md) runs these checks on your draft as you work, a moment after
each change, and nothing is saved or spent. The top of the page says **No problems** or, for example,
**2 problems**, or **1 tip** when only tips are left. Select it for a list in plain words, and **Show** to jump to the clip. The clips a problem is
about are outlined in red with an alert badge:

- a missing file: the clip that uses it;
- a clip longer than its source: that clip;
- a gap in the main video track: the clips on either side of it.

Problems that aren't about one clip, such as the audio and video ending at different times, are listed
without a **Show** button. **Use this timeline and continue** stays available, and runs the checks again.

## How to fix each

### timeline.schema

The message names the exact spot, such as `tracks.0.items.1.durationSec: Too small`. In the editor, correct
that item. If a model wrote the timeline, add the rule to its prompt.

### timeline.handles_resolve

A clip or audio file the timeline uses is **missing, stale or deleted**, or isn't one of the files the stage
was given. Re-run the stage that makes the file, or remove the item. A stale file means the stage that
produced it was redone after the timeline was written, so redo the timeline too.

### timeline.styles_exist

The message lists the unknown styles. Use **Title** or **Minimal Lower Third** for text, and a caption template (such as **Clean** or **Bold Pop**) for captions. In the editor, pick a template from the **Template** gallery. See [Timelines](./timelines.md#text-and-styles).

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

### timeline.motion_code

A motion graphic in the timeline uses something its code may not: another package, the network, the clock,
random numbers or CSS animations. The message lists each problem. Fix the code with **Edit code** on the
Generate Motion Graphic stage, or run that stage again.

### timeline.connectors

An arrow that joins two items can't reach one of its ends: the item it names isn't in the timeline (or has no
box), or it is on the screen while the arrow is in the world, or the other way round. Such an arrow draws
nothing. Delete the arrow, or put back the item it pointed at.

### timeline.canvas_match

The canvas shape, such as 1920 × 1080, doesn't match the aspect ratio set in your
[format defaults](../channels/defaults.md#format), such as 9:16. Change the canvas size, or the default.
This check only runs when an aspect ratio is set.

## Where you see the results

- In the **editor**, a failed submit lists the failures in a red box.
- On a **Generate Text** stage with a timeline output, failures count as failed
  [checks](../blueprints/checks.md): the stage tries again with the messages as feedback.
- In the stage's **Attempts**, each check shows with its message.
