---
title: Analyze Media
description: Transcribe speech with word timings, or read a media file's details.
---

**Analyze Media** looks at an audio or video file and reports on it. Use it to get the timings you
need for captions, or to find out how long a file is.

## What it makes

A `data` output. What's in it depends on the **Operation**:

- **Transcribe align**: the transcript, the language, the length, and the start and end time of
  every sentence and word. This is what [Export Subtitles](./export-subtitles.md) and a timeline's
  captions use.
- **Probe**: the file's length and its video and audio streams.

## Providers and models

For **Transcribe align**: **Deepgram** (Nova 3) or **Fake (test)**. It needs a Deepgram key. See
[AI provider keys](../provider-keys.md). Choose the model under **Model** or set a **Media analysis**
[default](../channels/defaults.md). **Probe** doesn't use a model.

## Inputs

- **`source`** (required, one audio or video file): the file to analyze. Bind it to, for example, a
  [Generate Speech](./generate-speech.md) stage's output.

## Settings

- **operation**, under **Config**: **Transcribe align** (speech to text with word timings, using
  Deepgram, paid) or **Probe** (reads the length and streams locally, free). It starts as Transcribe
  align.

## Cost

Transcribing is billed by Deepgram **by the length of the audio**. Reelcraft estimates the cost from
the file's length before it starts. Probe costs nothing.

:::warning Deepgram on a desktop install

Deepgram sends its transcript back to Reelcraft over the internet, so it needs a public address for
your Reelcraft. On a normal desktop install it can't reach your computer, and **Transcribe align**
doesn't work. **Probe** always works. (Deepgram transcripts for [quality
control](../blueprints/quality-control.md#include-transcript) are not affected.)

:::

## Tips

- If you only need a file's length, for example for a
  [`duration_range` check](../blueprints/checks.md), use **Probe**.
- The output of a transcription is a `data` object; give its stage a `data` output.

## Example

"Voice timings": `source` bound to the "Voice-over" stage, operation **Transcribe align**. Its output
feeds [Export Subtitles](./export-subtitles.md).
