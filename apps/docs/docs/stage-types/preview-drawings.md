---
title: Preview Drawings
description: Make one picture of a set of drawings, each with its id, to look at them together.
---

**Preview Drawings** makes one picture of a set of drawings from [Prepare Drawings](./prepare-drawings.md):
every drawing, fully drawn, in a grid with its id underneath. It uses the same drawing as the final video,
including the hand-drawn wobble. It runs on your computer, so it's free.

Use it to look at what a run drew before the video is made, or to give a
[quality-control](../blueprints/quality-control.md) judge that can see images something to judge the drawings by.

## What it makes

A single `media.image` output, a PNG called `drawings.png`.

## Inputs

- **`assets`** (required): the set of drawings, as made by Prepare Drawings.

## Settings

Under **Config**:

- **columns**: how many drawings across, 1 to 10. Default 5.
- **maxWaitSec**: how long to wait, in seconds. Default 300.

## Cost

Free. It uses your computer's time, usually a few seconds.

## Tips

- Add [human approval](../blueprints/iterate-conditions-approval.md#human-approval) after it to look at the
  drawings and send the run back to draw them again with a note.
- Add [quality control](../blueprints/quality-control.md) with a judge that can see images, and ask it whether
  each drawing is recognisable and matches its id.
