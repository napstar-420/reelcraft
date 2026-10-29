---
title: VoiceStudio
description: Free voice-over, your own cloned voices and word timings from VoiceStudio, a voice app you install next to Reelcraft.
---

[VoiceStudio](https://github.com/debpalash/VoiceStudio) is a free, open-source voice app that runs on
your own computer. Reelcraft can use it for:

- **Voice-over** in [Generate Speech](./stage-types/generate-speech.md), with any speech engine you
  install in VoiceStudio.
- **Your own voices**: make a voice from a recording in your channel's Library, or use the voices you
  cloned or designed in VoiceStudio.
- **Word timings** for captions, with no separate step.
- **Transcription** in [Analyze Media](./stage-types/analyze-media.md) and for
  [quality control](./blueprints/quality-control.md)'s **Include transcript**.

All of it is free: nothing is billed per request, and no text or audio leaves your computer.

VoiceStudio is a separate app. Reelcraft doesn't install, start or update it: it only talks to it while
it is running.

## Set it up

1. Install VoiceStudio from its [download page](https://github.com/debpalash/VoiceStudio/releases/latest),
   or with its install command (see VoiceStudio's
   [Get started](https://github.com/debpalash/VoiceStudio#get-started)). It runs on macOS, Windows and
   Linux, and in Docker.
2. Open VoiceStudio. The first time, it offers to download its default speech engine. Let it.
3. In Reelcraft, open **Settings → VoiceStudio**. The status at the top says **Connected to
   VoiceStudio**, with its version and what it runs on (`cuda` for an NVIDIA graphics card, `mps` for a
   Mac's GPU, `cpu` otherwise).

If it says VoiceStudio isn't reachable, check that VoiceStudio is open, then see
[Where Reelcraft looks for VoiceStudio](#where-reelcraft-looks-for-voicestudio).

## Where Reelcraft looks for VoiceStudio

VoiceStudio listens on port **3900**. Reelcraft looks for it at:

| Reelcraft runs                | Address                            |
| ----------------------------- | ---------------------------------- |
| Directly on your computer     | `http://127.0.0.1:3900`            |
| In Docker (the Reelcraft app) | `http://host.docker.internal:3900` |

To use another address, for example VoiceStudio on another computer with a graphics card, enter it
under **VoiceStudio address** in **Settings → VoiceStudio**, select **Test connection**, then **Save**.
**Reset** goes back to the default. The address can also be set with the `VOICESTUDIO_URL` environment
variable; one saved in Settings takes priority.

:::note Linux without Docker Desktop
Start the Reelcraft container with `--add-host=host.docker.internal:host-gateway`, or
`host.docker.internal` doesn't exist inside it.
:::

### API key

VoiceStudio accepts requests from the same computer without a key. If you started VoiceStudio with an
API key (`OMNIVOICE_API_KEY`, see VoiceStudio's
[API authentication](https://github.com/debpalash/VoiceStudio/blob/main/docs/api-auth.md)), Reelcraft
needs the same key when it reaches VoiceStudio from Docker or from another computer. Paste it under
**API key (optional)** in **Settings → VoiceStudio**, or set `VOICESTUDIO_API_KEY`. It is stored
encrypted, like the [AI provider keys](./provider-keys.md). Without it, the status says **VoiceStudio
refused the request**.

Use `https://` for a VoiceStudio on another computer, unless both are on a network you trust: over
plain `http://` the key travels unencrypted.

## Make speech with it

1. In a **Generate Speech** stage (or the **Speech and audio** [default](./channels/defaults.md)),
   choose **VoiceStudio** as the provider.
2. Choose a **Model**. Each speech **engine** installed in VoiceStudio is a model here, such as
   **VoiceStudio (OmniVoice)**, **KittenTTS** or **IndexTTS 2.5**. To get more, install them in
   VoiceStudio's **Model Catalogue**, then select **Check again**.
3. Choose a **Voice**: one you saved in VoiceStudio, or one of the engine's built-in voices. Until you
   choose, the engine's default voice speaks. Engines that can't clone (such as KittenTTS) only show
   their built-in voices.
4. Adjust the settings, and select **Speak it** to hear a sample. Samples are free.

A blueprint keeps the engine you chose, even if you switch the active engine inside VoiceStudio.

Settings:

- **Language**: the language code of the text, such as `en`, `es` or `hi`. Leave it empty and the
  engine works it out.
- **Speed**: from 0.5 (slower) to 2 (faster).
- **Delivery**: how to say it, in words, such as "calm and warm". Only engines that follow written
  instructions show it.
- **Word timings**: see [below](#word-timings).
- Under **Advanced**: **Seed**. The same seed, text and settings make the same take again.

Formats: WAV (default), MP3, FLAC and Opus. VoiceStudio takes about 4,000 characters at a time; a
longer script is split at sentence ends and joined, in WAV or MP3.

The first speech from an engine can take minutes: VoiceStudio loads the engine's model, and downloads
it the first time. After that it is quick.

## Your own voices

To make a voice from a recording:

1. Upload the recording to the channel's **Library** (see [Assets](./channels/assets.md)). Use a clean
   recording of one person speaking, about 5 to 30 seconds long. An audio or a video file works.
2. On its card, select **Make a VoiceStudio voice**.
3. Give the voice a name. Optionally type what the recording says and its language; if you leave them
   empty, VoiceStudio works them out.
4. Select **Make voice**.

The voice is saved in VoiceStudio, so it also appears in VoiceStudio's own app. In a Generate Speech
stage that uses VoiceStudio, pick it from the voice list like any other voice.

Voices you clone or design in VoiceStudio's own app appear in the list too.

:::caution
Only clone a voice you have the right to use: your own, or someone's who agreed to it.
:::

## Word timings

Turn on **Word timings** in a VoiceStudio Generate Speech stage and add a **Memory write** with the
path `timing`. After making the speech, VoiceStudio transcribes it and Reelcraft saves when each word
and sentence is spoken, for captions. It is the same as for ElevenLabs: see
[Word timings](./stage-types/generate-speech.md#word-timings). It is free, and adds a few seconds.

## Transcription

In [Analyze Media](./stage-types/analyze-media.md), choose **VoiceStudio** as the provider and
**VoiceStudio transcription** as the model to transcribe a voice-over, or any audio or video, with
word timings, for free. VoiceStudio uses the transcription engine that is active in it.

[Quality control](./blueprints/quality-control.md)'s **Include transcript** also uses VoiceStudio, when
the judge model can't listen to audio itself and VoiceStudio is running. It is used before Deepgram.

## When VoiceStudio is closed

- The stage editor shows **VoiceStudio isn't reachable**, with **Check again** and **Open
  VoiceStudio**. A stage keeps the engine you chose.
- You can still save the blueprint: it shows a warning, not an error.
- A run goes as far as the first stage that uses VoiceStudio and fails there, saying that VoiceStudio
  isn't reachable. Open VoiceStudio and [retry the stage](./runs/retries.md).

## Cost

Nothing. VoiceStudio runs on your computer. If you want your budget to count something anyway, enter a
price under **Advanced → Price per 1,000 characters**.
