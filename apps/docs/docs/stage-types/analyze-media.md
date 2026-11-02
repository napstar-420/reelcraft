---
title: Analyze Media
description: Transcribe speech with word timings, find a video's shots, or read a media file's details.
---

**Analyze Media** looks at an audio or video file and reports on it. Use it to get the timings you
need for captions, to find where a video cuts from one shot to the next, or to find out how long a file
is.

## What it makes

A `data` output. What's in it depends on the **Operation**:

- **Transcribe align**: the transcript, the language, the length, and the start and end time of
  every sentence and word. This is what [Export Subtitles](./export-subtitles.md) and a timeline's
  captions use.
- **Probe**: the file's length and its video and audio streams.
- **Shots**: the video's length and its `shots`, each with a `startSec` and `endSec`: a new shot
  starts wherever the picture changes sharply (a cut).

## Providers and models

For **Transcribe align**: **VoiceStudio** (**VoiceStudio transcription**, free, on your computer; see
[VoiceStudio](../voice-studio.md)), **Deepgram** (Nova 3, paid; it needs a Deepgram key, see
[AI provider keys](../provider-keys.md)) or **Fake (test)**. Choose the model under **Model** or set a **Media analysis**
[default](../channels/defaults.md). **Probe** and **Shots** don't use a model.

## Inputs

- **`source`** (required, one audio or video file): the file to analyze. Bind it to, for example, a
  [Generate Speech](./generate-speech.md) stage's output.

## Settings

- **operation**, under **Config**: **Transcribe align** (speech to text with word timings, using
  VoiceStudio, free, or Deepgram, paid) **Probe** (reads the length and streams locally, free) or **Shots** (finds the cuts in a video
  locally, free). It starts as Transcribe align.

## Cost

Transcribing with VoiceStudio costs nothing. Deepgram bills it **by the length of the audio**. Reelcraft estimates the cost from
the file's length before it starts. Probe and Shots cost nothing.

Reelcraft sends the audio to Deepgram itself, so **Transcribe align** works on a desktop install
too: Deepgram doesn't need to reach your computer.

## Tips

- If you only need a file's length, for example for a
  [`duration_range` check](../blueprints/checks.md), use **Probe**.
- **Shots** needs a video, not audio. Very short changes (under 0.4 seconds) count as one shot, and a
  video reports at most 150 shots.
- The output of a transcription is a `data` object; give its stage a `data` output.

## Example

"Voice timings": `source` bound to the "Voice-over" stage, operation **Transcribe align**. Its output
feeds [Export Subtitles](./export-subtitles.md).
