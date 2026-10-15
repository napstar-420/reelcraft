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

Bind this stage to the **music** input of [Compile Scenes](./compile-scenes.md). The music plays quietly
under the voice-over, gets quieter while someone speaks, is repeated if it is shorter than the video, and
fades out at the end. You can also bind it to an audio track of any timeline.

You can bring your own music instead: upload a song to the channel's assets and bind it the same way, or
fetch a free one with [Automate Browser](./automate-browser.md).

## Cost

ElevenLabs charges by the length of the track. Reelcraft reserves a ceiling from a list price per second
before the call, and your plan decides the real bill. Fake costs nothing.
