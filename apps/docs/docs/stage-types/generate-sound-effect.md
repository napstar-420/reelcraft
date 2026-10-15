---
title: Generate Sound Effect
description: Make a short sound effect, such as a pop or a whoosh, from a description.
---

**Generate Sound Effect** makes a short sound from words, for example "a soft pencil scratching on paper".

You don't need this stage for the usual whiteboard sounds: [Compile Scenes](./compile-scenes.md) can add
Reelcraft's [built-in sound effects](../video/timelines.md#sound-effects) for free. Use this stage when you
want a sound the built-in set doesn't have.

## What it makes

A single `media.audio` output.

## Inputs

None. Describe the sound in the stage's **Instructions**, which are required. Instructions can use
[run inputs and memory](../blueprints/connecting-stages.md) like any other stage.

## Model and settings

In the stage's **Model** section, choose a **Provider**: **ElevenLabs** (model **Sound Effects v2**) or
**Fake (test)**. Under **Config**:

- **durationSec**: how long the sound is, from 0.5 to 22 seconds (default 2).

## Cost

ElevenLabs charges by the length of the sound. Reelcraft reserves a ceiling from a list price per second
before the call, and your plan decides the real bill. Fake costs nothing.

## Tips

- Name the sound and how it should feel: "a short, bright bubble pop", not "pop".
- To use the sound, bind this stage to an audio track in a timeline, or to the **music** input of
  [Compile Scenes](./compile-scenes.md) if it is a background loop.
