---
title: Timeline editor
description: Arrange clips, images, audio and text by hand, with drag-and-trim, a preview and an inspector.
---

The timeline editor opens from a [Human Timeline Edit](../stage-types/human-timeline-edit.md) stage:
when the run pauses for it, select **Open editor** on the stage. The page is titled **Edit assembly**, with
the stage's key. **← Run** takes you back.

It has three areas: the **Media** panel on the left, the preview and tracks in the middle, and the
**Inspector** on the right.

## Saving and undoing

Everything you change is saved automatically. The top of the page says **Saving…** and then **All changes
saved**. **Undo** and **Redo** step through your changes.

If someone else, or another tab, saved a newer version, the page says **A newer draft exists — reloading…**.
If the run isn't waiting for this stage any more, the editor opens as **Read only**.

## Media

The **Media** panel lists everything you can use: the clips, images and audio the stage was given. Select one
to add it:

- images and videos go **at the end of the main video track**;
- audio goes on an **audio track**, creating one if there isn't one, starting at the beginning.

A clip is added with its real length when Reelcraft knows it.

### + Add text

**+ Add text** adds a title at the **point where the preview is paused** (the playhead), lasting 3
seconds, centred. Edit its words in the inspector.

## Preview

The preview plays the timeline as it will be rendered, with the same styles and motion. Use its controls to
play, pause and scrub.

## Tracks

Below the preview, the tracks show each clip, title and captions item as a bar on a time ruler.

- **Select** an item to edit it in the inspector.
- **Drag** an item left or right to move it in time. It **snaps** to the edges of the other items and to the
  nearest tenth of a second, and can't go before 0.
- **Drag an edge** to trim. The left edge changes where the item starts and how much of the source is used;
  the right edge changes how long it lasts. An item can't be made longer than its source allows, and not
  shorter than a tenth of a second.

## Inspector

Select an item to see its settings. Which ones depend on what it is.

**Text items**: **Text**, **Style**, **Position**.

**Captions**: **Caption style**. The words and their timing follow the speech and can't be changed here.

**Clips and images**:

- **Start (s)**, **Duration (s)** and, for video, **Trim in (s)**;
- **Volume**, for video and audio;
- **Fit**: **Cover**, **Contain** or **Fill**;
- **If the source is shorter**: **Stop at its end (trim)**, **Loop it**, **Hold the last frame**, **Slow it
  down to fit**;
- **Fade in (s)** and **Fade out (s)**;
- **Motion**: **None**, **Ken Burns (zoom and drift)**, **Zoom in**, **Pan**, and the **Motion strength**;
- **Transition in**: **None**, **Crossfade**, **Slide**, **Wipe**, and its **Length (s)**.

**Delete item** removes it. See [Timelines](./timelines.md) for what each setting does.

## Submit timeline

When you're done, select **Submit timeline**. Reelcraft runs the [timeline checks](./timeline-checks.md):

- If they pass, the run continues.
- If they don't, a red box lists what's wrong, for example *timeline.coverage: primary video track has gaps*,
  and you stay in the editor to fix it.
