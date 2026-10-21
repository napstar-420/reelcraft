---
title: Generate Motion Graphic
description: Have a model write a motion graphic, such as an animated title, chart or diagram, as Remotion code.
---

**Generate Motion Graphic** has an AI model write a motion graphic for anything your video needs:

- an animated title or a lower third;
- a chart that grows, a counter, a timeline, a diagram that builds;
- a list, a callout or a logo sting.

You describe it in **Instructions**. The model writes it as [Remotion](https://www.remotion.dev) code: one
small component that is drawn frame by frame. [Render Motion Graphic](./render-motion-graphic.md) then turns
the code into a clip that you place on a timeline like any other video.

There's no fixed list of effects. Whatever you can describe, the model can try to animate.

## Which models can write it

Any model that can write text can write a motion graphic, including the models you reach through OpenRouter.

**Codex** and **Claude** do more. Each job gets a small working folder with a guide, a starting example and a
check script. The model writes the graphic, runs the check, and looks at pictures of the start, middle and end
of its own animation. It fixes what's wrong before it answers. That usually gives a better first result. See
[Connect Codex](../codex.md) and [Connect Claude](../claude-code.md).

## What it makes

A `data` output: the code, plus the size, frame rate, length, background and data the code needs. Give the
output the motion graphic schema; the assistant and the example blueprint have it. In the run, the output has a
**Code** tab where you can read the code.

## Inputs

All inputs are optional:

- **`data`**: an object the graphic is given, such as the numbers for a chart or the words for a title. Bind
  it to an earlier stage's data so the same graphic works for every run.
- **`assets`**: images the graphic may show, such as a logo or a photo. They can come from the run or your
  library.
- **`canvas`**: a timeline to take the size and frame rate from.

## Settings

| Setting          | What it does                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| **durationSec**  | How long the graphic runs, 1 to 60 seconds. Leave it empty to let the model choose.                   |
| **width/height** | The size. The default is the canvas, otherwise 1920 by 1080.                                          |
| **fps**          | Frames a second. The default is the canvas, otherwise 30.                                             |
| **background**   | `transparent` (the default) to lay the graphic over other video, or `opaque` to fill the whole frame. |
| **style**        | The look in a few words: colours, fonts, mood.                                                        |

## The rules the code must follow

The stage owns its system prompt, which teaches the model these rules:

- The graphic is one file that imports only Remotion's own packages and React.
- Everything moves with the frame number. CSS animations, timers and the clock are not allowed.
- Every render must look the same. For randomness the code uses Remotion's seeded `random()`.
- The graphic has no network. It can only load the images it was given.
- Raw HTML, scripts and frames are not allowed.

Add the `motion_code` [built-in check](../reference/built-in-checks.md) and set **Check attempts** to 2 or 3.
Code that breaks a rule then goes back to the model with every problem listed, so it can fix them all at once.
Render Motion Graphic checks the code again before it renders, so code that breaks the rules is never run.

## Two ways into a video

- **As a clip.** [Render Motion Graphic](./render-motion-graphic.md) renders it to a video, transparent or not,
  that Compose Timeline places like any clip. The clip can be checked, approved and reused on its own.
- **Embedded.** Bind the output straight to [Compose Timeline](./compose-timeline.md) and place it with a
  `motion` layer. The code goes into the timeline and the final render draws it, at the video's own resolution,
  with no clip in between. The editor's preview shows a placeholder for it.

## Edit the code

When a graphic is nearly right, change it yourself instead of running the stage again. Open the stage's
details on the run, and under the output select **Edit code**:

1. Change the code, and the **Length (s)** if you like. The rules are checked as you type, and every problem
   is listed with its line. **Follows the rules** means it can be rendered.
2. Select **Render preview** for pictures of the start, middle and end, rendered with the graphic's own files.
   A checkerboard shows through where a transparent graphic draws nothing.
3. Select **Save**. Reelcraft lists the later stages that will run again with your version, such as
   [Render Motion Graphic](./render-motion-graphic.md) and Compose Timeline, and what that may cost. Select
   **Save and run again** to keep it.

Your version becomes the stage's output, marked as edited by you; the model's version is kept in the stage's
attempts. You can edit a run's output when it is paused, failed or finished.

## Cost

The model is paid by your usual provider, or by your ChatGPT or Claude plan. Rendering the code is free.

## Tips

- Put every word and number in the instructions or in `data`. The model shows what you give it.
- Make one graphic per idea, and [iterate](../blueprints/iterate-conditions-approval.md) the stage over a list
  to make all of them. See [Layered videos](../video/layered-videos.md).
- Use **transparent** for anything that sits over footage, such as lower thirds, callouts and labels. Use
  **opaque** for full-screen titles and charts.
