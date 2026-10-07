---
title: Generate Speech
description: Turn text into a voice-over, with the voice, model and delivery you choose.
---

**Generate Speech** reads text aloud and makes an audio file.

## What it makes

A single `media.audio` output. Reelcraft also keeps the words that were spoken, so checks and quality
control can use them.

## Inputs

- **`text`** (required, one text value): what to say. Bind it to the output of a stage whose output is
  `text`, such as a script. A text field inside a `data` output can't be used here: a `text` slot only
  accepts a `text` output, and Reelcraft shows **incompatible source: source kind "data" does not match
  accepted kind "text"**. Have a stage write the script as `text`, and another stage plan the scenes as
  `data` if you need both. See [Connecting stages](../blueprints/connecting-stages.md).
  A fixed text value (**const**) and a run input of type text work too.

The text is spoken exactly as written. This stage has no **Instructions**, because nothing here is a
prompt: to change what is said, change the stage that writes the script.

## Model, voice and settings

Everything about how the voice sounds is in the stage's **Model** section. It is also what you set as
the **Speech and audio** [default](../channels/defaults.md) for a channel or blueprint.

1. Choose a **Provider**: **ElevenLabs**, **Deepgram** or **Fake (test)**.
2. Choose a **Model**. Each card says what the model is for, how many languages it speaks and how much
   text it takes in one request. Select **Change model** to see the others.
3. Choose a **Voice**. Select the box to search by name, accent or use, filter by gender or language,
   and play a sample with ▶.
4. Adjust the settings. Only the settings the chosen model supports are shown. Each has an **ⓘ**
   explaining it, and a slider has a reset button once you move it. A setting you never touch is not sent, so the
   provider's own default applies.
5. Pick an **Output format** if the default MP3 or WAV isn't what you want.
6. Select **Speak it** under **Hear a sample** to hear a short line (edit it if you like) with the voice
   and settings as they are now. Each sample is a real, billed request: the button shows the price first
   (well under a cent for a short line), and Reelcraft shows what it cost afterwards. It is
   not part of any run's budget.

Changing the provider clears the model, voice and settings, since each service has its own. Changing
the model keeps the settings the new model also has and drops the rest.

### ElevenLabs

You need an [ElevenLabs key](../provider-keys.md) that can use text to speech, and for the voice list
**Voices: Read**.

| Model               | Good for                                                     |
| ------------------- | ------------------------------------------------------------ |
| **Eleven v4**       | The most expressive voices, with audio tags. 90+ languages.  |
| **Eleven v4 Turbo** | The same delivery, faster and half the price.                |
| **Eleven v3**       | Expressive, with audio tags. 70+ languages.                  |
| **Multilingual v2** | Steady, lifelike narration. 29 languages. Best for long form |
| **Flash v2.5**      | Fast and half the price. 32 languages.                       |

The list always matches what your account can use: Reelcraft asks ElevenLabs for it, so new models
appear without an update. If ElevenLabs can't be reached, the known models are shown.

Settings, where the model supports them:

- **Stability**: lower is more expressive, higher is more consistent. Eleven v3 offers **Creative**,
  **Natural** and **Robust** instead of a slider.
- **Similarity**: how closely the voice is followed.
- **Style exaggeration**, **Speed** (0.7 to 1.2) and **Speaker boost**.
- **Language**: forces the language instead of detecting it.
- **Pronunciation dictionaries**: up to three from your ElevenLabs account.
- **Word timings**: also gets when each word is spoken, so captions need no transcription step. See
  [Word timings](#word-timings).
- Under **Advanced**: **Seed** (the same seed gives nearly the same speech again), **Text
  normalisation**, **Language text normalisation** (Japanese), the instant-clone switch for
  professional voices, and **Request logging** (zero retention is an Enterprise feature).

Eleven v3 and v4 read tags such as `[whispers]` or `[laughs]` in the text. Other models would speak
them aloud, so only use tags with those models.

:::note Free ElevenLabs plans

Free plans can only use **premade** voices through the API. A **library** voice you added fails with
"Free users cannot use library voices via the API". The voice list shows each voice's kind.

:::

### Deepgram

You need a [Deepgram key](../provider-keys.md). Deepgram makes speech straight away, so, unlike
transcription, it works on a desktop install.

| Model        | Good for                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| **Flux TTS** | Deepgram's newest voices. English only. Speed, expressivity (beta), pronunciations.   |
| **Aura-2**   | English, Spanish, German, French, Dutch, Italian and Japanese. Speed, pronunciations. |
| **Aura**     | The first generation. English only, half the price of Aura-2.                         |

The voice is part of the model, so choosing another model asks you to choose a voice again.

- **Speed**: 0.5 to 1.5 on Flux, 0.7 to 1.5 on Aura-2. Works in English and Spanish.
- **Expressivity** (Flux, beta): from calm to animated. 0 is the tuned default; other values can add
  or drop words, so listen before you rely on one.
- **Pronunciations**: a word and how to say it in IPA. Reelcraft marks each occurrence in the text.
  On Flux this is early access and can't be combined with a speed other than 1.
- Under **Advanced**: opting out of Deepgram's model improvement program, and a usage tag for
  Deepgram's reports.

For a pause in Flux, write `\{pause:1s\}` in the text (500 ms to 3 s, at most 8 per request).

### Word timings

With **Word timings** on (ElevenLabs only), the stage still makes the same audio, and also keeps when
each word and sentence is spoken. To use them, open **Output & memory writes** and add a **Memory
write** with the path `timing`, for example the key `voiceTiming` and the path `timing`. Later stages
read it with a `memory` reference: it has the same shape as the result of **Transcribe align** in
[Analyze Media](./analyze-media.md) (`transcript`, `durationSec`, `sentences` and `words`), so it
works where that result does, such as [Export Subtitles](./export-subtitles.md).

- It costs nothing extra: ElevenLabs sends the timings with the audio.
- A blueprint that writes `timing` is not runnable while **Word timings** is off, or on a model that
  can't make them (Deepgram).
- For a text longer than the model takes at once, the pieces' timings are joined end to end, so later
  words can drift by a fraction of a second.
- Text such as `[whispers]` is acted out by the model and left out of the words.

### Output format

| Provider   | Formats                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| ElevenLabs | MP3 (several rates), WAV, Opus. `MP3 44.1 kHz 192 kbps` needs a Creator plan, WAV 44.1 kHz a Pro plan. |
| Deepgram   | WAV (default), MP3, FLAC, Opus, AAC                                                                    |

### Long text

Each model takes a limited number of characters in one request (for example 2,000 on Deepgram). Longer
text is split at sentence ends, spoken piece by piece and joined into one file. Splitting works for
**MP3** and **WAV**. For the other formats, a text that is too long fails with a message saying so:
choose MP3 or WAV, or shorten the text.

## Cost

Paid by the provider, by the number of characters. Reelcraft estimates it from the provider's list
price before the call and shows it under the model's settings. If your plan charges differently,
enter your price under **Advanced → Price per 1,000 characters**, and the estimate and your
[budget](../runs/budget-and-costs.md) follow it.

| Model                              | List price per 1,000 characters |
| ---------------------------------- | ------------------------------- |
| ElevenLabs v4, v3, Multilingual v2 | $0.10                           |
| ElevenLabs v4 Turbo, Flash         | $0.05                           |
| Deepgram Flux                      | $0.045                          |
| Deepgram Aura-2                    | $0.03                           |
| Deepgram Aura                      | $0.015                          |

## Checks and quality control

- The `wpm` [check](../blueprints/checks.md) measures speaking pace: the words spoken, divided by the
  audio's length. Use it to catch a voice-over that's too rushed or too slow.
- `duration_range` checks the audio's length.
- [Quality control](../blueprints/quality-control.md) can judge the voice-over if you tick **Include
  transcript**.

## If it fails

- **"no voice is chosen"** (ElevenLabs): ElevenLabs voices belong to your account, so there is no
  default. Choose one.
- **"the key was rejected"**: check the key under **Settings**, and that it has the permissions above.
- **Voice list says the key is missing a permission**: give the key **Voices: Read**, or paste a voice
  ID into the box the list shows.

## Tips

- Follow this stage with [Analyze Media](./analyze-media.md) to get word timings for captions.
- Write the script for the ear: short sentences, numbers as words.

## Example

"Voice-over": `text` bound to the `script` memory key, written by a stage with a `text` output, voice
**Bella** on **Eleven v4**, with a `wpm` check between 130 and 170.
