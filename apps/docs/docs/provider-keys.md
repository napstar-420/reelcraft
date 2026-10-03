---
title: Add AI provider keys
description: Paste API keys for OpenRouter, fal, ElevenLabs and Deepgram in Reelcraft's Settings.
---

Reelcraft uses paid AI services through **API keys**: secret codes from each service that let
Reelcraft use your account. You only need keys for the services you want. Without any, Reelcraft
uses its free test provider.

## The services

| Service                             | Used for                                                 | Get a key                                                          |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| [OpenRouter](https://openrouter.ai) | Text and image models from many vendors, through one key | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| [fal](https://fal.ai)               | Image and video generation                               | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)             |
| [ElevenLabs](https://elevenlabs.io) | Voice-over (text to speech)                              | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys) |
| [Deepgram](https://deepgram.com)    | Transcription and captions                               | [console.deepgram.com](https://console.deepgram.com)               |

Each service bills you directly for what Reelcraft uses. Most let you set a spending limit on
their website, which is a good idea.

:::note Deepgram on a desktop install

Deepgram sends the results of an [Analyze Media](./stage-types/analyze-media.md) stage back to
Reelcraft over the internet, so it needs a public address for your Reelcraft. On a normal desktop
install it can't reach your computer, and that stage's **Transcribe align** setting doesn't work.
Deepgram transcripts for [quality control](./blueprints/quality-control.md#include-transcript) are not
affected.

:::

## Add a key

1. In Reelcraft, click **Settings** in the sidebar.
2. Under **AI providers**, find the service and click **Get a key** to open its website. Create a
   key there and copy it.
3. Paste the key into the box next to the service and click **Save**.
4. Click **Test** to check that the key works. You see **The key works.** or the reason it
   doesn't. (fal has no test; its key is checked the first time you use it.)

![The AI providers card in Settings](/img/app/settings-providers.png)

The key takes effect straight away; there is no need to restart Reelcraft.

After saving, the badge says **Saved** with the key's last four characters. Reelcraft never shows
the whole key again. To change it, paste a new key and click **Save**. To remove it, click
**Remove**.

## How keys are stored

Saved keys are **encrypted** in Reelcraft's database. The encryption key is generated on the first
start and kept in `/data/secrets.env`, inside your volume. Backups of the volume therefore include
both, so [back up the whole volume](./backup.md).

If that file is lost or replaced, saved keys can't be read any more. Their badge then says
**Saved key can't be read**: click **Remove**, then paste the key again.

## Setting keys when the container starts

You can also give keys to the container as **environment variables**. This is useful if you
manage Reelcraft with scripts. A key set this way **takes priority** over a saved one, and
Settings shows it as **Set by container environment**, without a box to change it.

| Variable             | Service    |
| -------------------- | ---------- |
| `OPENROUTER_API_KEY` | OpenRouter |
| `FAL_KEY`            | fal        |
| `ELEVENLABS_API_KEY` | ElevenLabs |
| `DEEPGRAM_API_KEY`   | Deepgram   |

In Docker Desktop, add them under **Optional settings → Environment variables** when you click
**Run**. On the command line, add `-e NAME=value` to `docker run`. Environment variables can only
be set when a container is created, so changing one means
[recreating the container](./updating.md#update-to-a-new-image) with the same volume.

:::warning

Anyone who can open Reelcraft can use these keys. Keep Reelcraft on your own computer or a
trusted network.

:::
