---
title: Generate Speech
description: Turn text into a voice-over.
---

**Generate Speech** reads text aloud and makes an audio file.

## What it makes

A single `media.audio` output. Reelcraft also keeps the words that were spoken, so checks and quality
control can use them.

## Providers and models

**ElevenLabs** (currently Eleven Turbo v2.5) or **Fake (test)**. Choose one under **Model** or set a
**Speech and audio** [default](../channels/defaults.md). It needs an ElevenLabs key. See
[AI provider keys](../provider-keys.md).

## Inputs

- **`text`** (required, one text value): what to say. Bind it to the output of a stage whose output is
  `text`, such as a script. A text field inside a `data` output can't be used here: a `text` slot only
  accepts a `text` output, and Reelcraft shows **incompatible source: source kind "data" does not match
  accepted kind "text"**. Have a stage write the script as `text`, and another stage plan the scenes as
  `data` if you need both. See [Connecting stages](../blueprints/connecting-stages.md).
  A fixed text value (**const**) and a run input of type text work too.

The voice and speed come from the model and its **Params**. See
[Models](../blueprints/models.md).

## Settings

None of its own.

## Cost

Paid by ElevenLabs, based on the amount of text.

## Checks and quality control

- The `wpm` [check](../blueprints/checks.md) measures speaking pace: the words spoken, divided by the
  audio's length. Use it to catch a voice-over that's too rushed or too slow.
- `duration_range` checks the audio's length.
- [Quality control](../blueprints/quality-control.md) can judge the voice-over if you tick **Include
  transcript**.

## Tips

- Follow this stage with [Analyze Media](./analyze-media.md) to get word timings for captions.
- Write the script for the ear: short sentences, numbers as words.

## Example

"Voice-over": `text` bound to the `script` memory key, written by a stage with a `text` output, with a
`wpm` check between 130 and 170.
