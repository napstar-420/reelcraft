---
title: Export Subtitles
description: Make an SRT or VTT subtitle file from word timings.
---

**Export Subtitles** turns a transcript with timings into a standard subtitle file. It runs inside
Reelcraft, so it's free.

## What it makes

A `file.subtitles` output: `captions.srt` or `captions.vtt`, with one subtitle per sentence.

## Inputs

- **`timing`** (required, one object): a transcript with timings, as made by
  [Analyze Media](./analyze-media.md) with the **Transcribe align** operation. Bind it to that stage's
  output.

## Settings

Under **Config**:

- **format**: `srt` (the default) or `vtt`.

## Cost

Free.

## Using the file

- Give it to [Concatenate Video](./concatenate-video.md)'s `subtitles` slot, with **burnSubtitles** on,
  to draw the words onto the video.
- Or keep it as a download from the run. See
  [Outputs and downloads](../runs/outputs-and-downloads.md).

For captions that are styled and animated, use a `captions` item in a
[timeline](../video/timelines.md) instead; it uses the same timings.

## Example

"Subtitles": `timing` bound to the "Voice timings" stage, **format** `srt`.
