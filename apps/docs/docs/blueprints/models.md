---
title: Models
description: Choose which provider and model a stage uses, with the settings that go with it.
---

Stages that call an AI service need a **model**. You choose one in the inspector's **Model** section,
or set a [default](../channels/defaults.md) once for the whole channel or blueprint.

If you haven't added any keys yet, the **Fake (test)** provider is always there: it makes
placeholder results for free, so you can build and try a blueprint before paying for anything. See
[AI provider keys](../provider-keys.md) to add real ones.

## Pick a model

1. Open the stage and find **Model**.
2. Under **Provider**, choose a provider. This clears any model you'd chosen.
3. Under **Model**, choose a model. The list only shows models that can do this stage's kind of
   work, such as text or video.
4. Adjust the settings below if you need to.

To go back to the default, select **Unset model**. The stage then uses the blueprint's or channel's
default for its kind of work.

:::warning Every model stage needs a model from somewhere

Reelcraft doesn't warn you when a stage that calls an AI service has no model and there's no default
for its kind of work. The blueprint still shows **Runnable**, but when the run reaches that stage it
fails with `ProviderRegistry: unknown provider "undefined"`, after a few retries. If you see that
message, set a model on the stage or a [default](../channels/defaults.md).

:::

If a provider has no available model for the stage, the box says why, for example that
[Codex needs its image extension](../codex.md) or that BrowserOS Neo isn't running.

## Providers

| Provider       | What it does in Reelcraft                                                        |
| -------------- | -------------------------------------------------------------------------------- |
| **OpenRouter** | Text and image models from many vendors, paid by use with your OpenRouter key    |
| **fal**        | Video generation                                                                 |
| **ElevenLabs** | Speech (voice-over)                                                              |
| **Deepgram**   | Transcription and word timings, for Analyze Media                                |
| **Codex**      | Text, and image and browser steps, using your ChatGPT plan. See [Connect Codex](../codex.md) |
| **ChatGPT**    | Text and images through a ChatGPT tab in BrowserOS Neo. See [BrowserOS Neo](../browseros-neo.md) |
| **Fake (test)** | Free placeholder results for every kind of work                                 |

Which providers appear depends on what you've set up in **Settings**.

## Model settings

Which of these you see depends on the provider.

- **Version**: pin a specific version or snapshot of the model, if the provider has them. Leave it
  empty to use the provider's current one.
- **Effort** (Codex and ChatGPT): how hard the model thinks before answering. Higher is slower and
  uses more of your plan. The choices depend on the model.
- **Web search** (ChatGPT): let the model search the web for this stage's prompt.
- **Params**: extra settings passed to the provider on every call, such as `max_tokens` or
  `temperature`. Select **+ add param**, name it, and enter a value as text, a number or true/false.
  Reelcraft sends them to the provider as you typed them, so use names the provider documents. The
  same params also go to this stage's quality control call.

## Default or per stage?

A stage's own model always wins. Otherwise Reelcraft uses the blueprint's default for the stage's
kind of work, then the channel's. See [Defaults](../channels/defaults.md#what-wins).

A good pattern is to set text, image, video and speech defaults on the channel, and then only pin a
model on a stage that needs a different one, such as a more capable model for a tricky script.

## Models and cost

Each provider bills in its own way, and Reelcraft estimates the cost of a call before making it. See
[Budget and costs](../runs/budget-and-costs.md) and [Costs](../reference/costs.md).

## The quality control judge

A stage's [quality control](./quality-control.md) has its own model, chosen in the same way but
separately: it doesn't use these defaults.
