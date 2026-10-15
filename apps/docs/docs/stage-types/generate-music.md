---
title: Generate Music
description: Make background music from a description, to play quietly under a voice-over.
---

**Generate Music** makes an instrumental track from a description, such as "calm, light piano for an
explainer video".

## What it makes

A single `media.audio` output.

## Inputs

None. Describe the music in the stage's **Instructions**, which are required.

## Model and settings

In the stage's **Model** section, choose a **Provider**: **ElevenLabs** (model **Music v1**) or
**Fake (test)**. Under **Config**:

- **durationSec**: how long the track is, from 3 to 600 seconds (default 30).

The music is always instrumental, so it doesn't compete with a voice-over.

## Using it

Bind this stage to [Compose Timeline](./compose-timeline.md): list a name for it under **inputs** (for example
`music`), bind the stage to that slot, and put a layer in the plan with `asset: "music"`, `loop: true`, a low
`volume` (about 0.15) and a `fadeOutSec`. Use the plan's `ducks` to make the music quieter while the voice-over
plays. Loop repeats the track if it is shorter than the video. You can also bind it to an audio track of any
timeline.

You can bring your own music instead: upload a song to the channel's [library](../channels/assets.md#the-library)
and pick it from there, or fetch a free one with [Automate Browser](./automate-browser.md).

## Cost

ElevenLabs charges by the length of the track. Reelcraft reserves a ceiling from a list price per second
before the call, and your plan decides the real bill. Fake costs nothing.
