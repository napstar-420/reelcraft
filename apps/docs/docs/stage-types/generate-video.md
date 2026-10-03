---
title: Generate Video
description: Make a short video clip from a prompt, with optional start and end frames and references.
---

**Generate Video** makes a short clip, usually a few seconds long.

## What it makes

A single `media.video` output. Reelcraft expects the clip to come with sound: if a provider returns a
silent clip, the stage fails.

## Providers and models

**fal** (currently Kling Video v3 Standard) or **Fake (test)**. Choose one under **Model** or set a
**Video** [default](../channels/defaults.md). Kling v3 Standard makes 5 or 10 second clips in 16:9,
9:16 or 1:1, up to 1920×1080, with sound.

## Inputs

All optional:

- **`startFrame`** (one image): the clip begins like this picture.
- **`endFrame`** (one image): the clip ends like this picture.
- **`references`** (many images, up to 4 with Kling v3): pictures the model should keep in the clip,
  such as a [character](../channels/characters.md).

The prompt is the **Template**. See [Prompts](../blueprints/prompts.md).

## Settings

None of its own.

## Cost

Paid per clip by fal, and usually the most expensive stage in a blueprint. Keep an eye on the run's
[budget](../runs/budget-and-costs.md), and try the blueprint with a [dry run](../runs/dry-runs.md)
first.

## Tips

- To make a video from an image, bind the image to `startFrame`.
- To make clips that flow into each other, [iterate](../blueprints/iterate-conditions-approval.md)
  over the scenes and bind `startFrame` to **prevItem** with the path `lastFrame`. See
  [Connecting stages](../blueprints/connecting-stages.md#paths).
- There's no automatic quality control for video. Add
  [human approval](../blueprints/iterate-conditions-approval.md#human-approval) instead. A video stage
  with neither checks nor approval shows a warning.
- Join the clips afterwards with [Concatenate Video](./concatenate-video.md) or
  [Render Timeline](./render-timeline.md).

## Example

"Scene clip": iterates over the `scenes` memory key, with a context entry `visual` bound to the item's
`visual` field, Template `{{ visual }}`, `startFrame` bound to the scene
image and Human approval in `item` mode.
