---
title: Stage types
description: What each kind of stage does, which services it uses, and what it costs.
---

Every stage in a blueprint has a **type**, shown in the inspector as **Capability**. The type decides
what the stage does, what inputs (slots) and settings it has, and what it can output.

| Type                                                      | What it does                                              | Output                     | Cost               |
| --------------------------------------------------------- | --------------------------------------------------------- | -------------------------- | ------------------ |
| [Generate Text](./generate-text.md)                       | Writes text, structured data or a timeline with an AI model | `text`, `data`, `timeline` | Paid, or your ChatGPT plan |
| [Generate Image](./generate-image.md)                     | Makes an image from a prompt                              | `media.image`              | Paid, or your ChatGPT plan |
| [Generate Video](./generate-video.md)                     | Makes a short video clip                                  | `media.video`              | Paid               |
| [Generate Speech](./generate-speech.md)                   | Turns text into a voice-over                              | `media.audio`              | Paid               |
| [Analyze Media](./analyze-media.md)                       | Transcribes speech with word timings, or reads a file's details | `data`               | Paid, or free      |
| [Concatenate Video](./concatenate-video.md)               | Joins clips into one video, with sound and subtitles      | `media.video`              | Free               |
| [Render Timeline](./render-timeline.md)                   | Renders a timeline into a finished video                  | `media.video`              | Free               |
| [Export Subtitles](./export-subtitles.md)                 | Makes an SRT or VTT file from word timings                | `file.subtitles`           | Free               |
| [Human Input](./human-input.md)                           | Pauses for you to type or paste something                 | `text`, `data`             | Free               |
| [Human Timeline Edit](./human-timeline-edit.md)           | Pauses for you to edit a timeline by hand                 | `timeline`                 | Free               |
| [Automate Browser](./automate-browser.md)                 | Lets Codex use a signed-in browser to do a task           | `data`                     | Uses your ChatGPT plan |

**Paid** types call an AI service that bills you directly, and are limited by the run's
[budget](../runs/budget-and-costs.md). **Free** types run inside Reelcraft. See
[Costs](../reference/costs.md) for the details.

Add a stage by choosing its type under the stages on the canvas. See
[Blueprints](../blueprints/blueprints.md#add-a-stage).

## How a blueprint usually fits together

A typical video blueprint chains these types:

1. **Generate Text** writes a script, as `data`, with a list of scenes.
2. **Generate Image** or **Generate Video** makes the visuals, once per scene, using
   [iterate](../blueprints/iterate-conditions-approval.md#iterate).
3. **Generate Speech** records the voice-over.
4. **Analyze Media** gets word timings from the voice-over, and **Export Subtitles** or the timeline's
   captions use them.
5. **Generate Text** (as `timeline`) or **Human Timeline Edit** arranges everything on a timeline.
6. **Render Timeline**, or **Concatenate Video**, makes the finished video.

See [Assembly](../video/assembly.md).
