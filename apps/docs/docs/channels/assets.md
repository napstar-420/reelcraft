---
title: Assets
description: Upload images, video and audio once, and reuse them in your blueprints.
---

**Assets** are media files you upload to a channel to reuse, such as a logo, an intro clip or
background music. Open a channel and select the **Assets** tab.

## Upload an asset

1. Select **New asset**.
2. Enter a **Name**. Names must be unique within the channel.
3. Choose the **Kind**: **Image**, **Video** or **Audio**. The file picker then only offers files
   of that kind.
4. Optionally add **Tags**, separated by commas, such as `intro, brand`.
5. Under **File**, drop a file onto the box, or select it to choose one.
6. Select **Create**. A bar shows the upload's progress.

If the name is already taken in the channel, the dialog says **An asset named "…" already exists in
this channel** and keeps your file, so you can change the name and try again.

## Find an asset

Each card shows a preview, the asset's kind, its size, its dimensions for images and video, the
length of a video, and its tags.

Above the cards you can:

- **Search assets…** by name;
- show one kind only, or **All types**;
- sort by **Newest first**, **Name** or **Size**.

## Use an asset in a stage

In a stage's inspector, bind a slot or a piece of context to **asset**, then pick the asset by name.
See [Connecting stages](../blueprints/connecting-stages.md). For example, bind an intro clip into a
[Concatenate Video](../stage-types/concatenate-video.md) stage, or background music into a
timeline.

When a run starts, it records which file each asset pointed to, so the run isn't affected by what
you do to the asset afterwards.

## Delete an asset

Select the bin on the asset's card and confirm.

- The name is free again straight away, so you can upload a replacement with the same name.
- Runs that already used the asset keep working.
- A blueprint that still uses the deleted asset shows an error, and new runs of it won't start until
  you pick another asset.
- The file is removed from storage in the background. By default that happens about 30 days later.

:::note Fonts and LUTs

The Assets tab mentions fonts and LUTs, and older channels may still list some. You can't upload new
ones, because no stage uses them yet.

:::
