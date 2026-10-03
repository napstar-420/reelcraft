---
title: Outputs and downloads
description: Look at what each stage made, download files, and find out how the final video is chosen.
---

Every stage that finishes leaves an **output**. You can look at any of them from the run page, while the
run is going or long after.

## View an output

On a stage's card (or in the canvas run panel), select **View output**. A panel opens, titled **Output of**
the stage. It shows the stage's current output, or **No output yet. This stage is still running.**
A stage that [iterates](../blueprints/iterate-conditions-approval.md#iterate) shows one block per item:
**Item 1**, **Item 2**, and so on.

How each kind of output looks:

| Output           | What you see                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| `text`           | The text, with a copy button                                                          |
| `data`           | A collapsible **Tree** of its fields, or the **Raw JSON**. Hover a field to copy its path, ready for a binding or a memory write |
| `timeline`       | The **Lanes**: tracks of clips, text and captions along a time ruler, or the **Raw JSON** |
| `media.image`    | The picture. Select it to open it full size                                           |
| `media.video`    | A player                                                                              |
| `media.audio`    | A player                                                                              |
| `file.subtitles` | The first cues of the file, and a **Download** link                                   |

Images, video and audio have a **Download** button.

A stage can also have **attachments**: extra files that came with its result, such as screenshots from
[Automate Browser](../stage-types/automate-browser.md). They're listed under the output as links.

## Outputs that are no longer available

An output can be replaced when a stage is redone. See [Retries](./retries.md). The old version is marked
**Stale**, and the stage shows its new output once it has one. A file whose storage was cleaned up, for
example after its channel was deleted, is gone for good.

## The final video

The **Final video** at the top of the run page is the output of the **last stage, in blueprint order, that
passed and made a video**. It appears as soon as that stage finishes, and has its own poster image.

So the order of stages matters: put the stage that makes the finished video last. If a blueprint ends with
a [Render Timeline](../stage-types/render-timeline.md) or
[Concatenate Video](../stage-types/concatenate-video.md) stage, its video is the final one. A blueprint
that never makes a video has no final video, and that's fine.

To keep a video, use the **Download** button on the video, or on the stage's output.

## Where files live

The files a run makes are stored in Reelcraft's own storage, inside its Docker volume, so
[back up the volume](../backup.md) to keep them. Deleting a run's channel or blueprint removes its files
after a retention period, by default 30 days. See [Channels](../channels/channels.md#delete-a-channel).
