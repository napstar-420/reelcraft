---
title: Stage types
description: What each kind of stage does, which services it uses, and what it costs.
---

Every stage in a blueprint has a **type**, shown in the inspector as **Capability**. The type decides
what the stage does, what inputs (slots) and settings it has, and what it can output.

| Type                                                      | What it does                                                                 | Output                             | Cost                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| [Generate Text](./generate-text.md)                       | Writes text, structured data or a timeline with an AI model                  | `text`, `data`, `timeline`         | Paid, or your ChatGPT plan        |
| [Generate Image](./generate-image.md)                     | Makes an image, or several, from a prompt                                    | `media.image`, image list          | Paid, or your ChatGPT plan        |
| [Generate Video](./generate-video.md)                     | Makes a short video clip                                                     | `media.video`                      | Paid                              |
| [Generate Speech](./generate-speech.md)                   | Turns text into a voice-over                                                 | `media.audio`                      | Paid                              |
| [Generate Sound Effect](./generate-sound-effect.md)       | Makes a short sound effect from a description                                | `media.audio`                      | Paid                              |
| [Generate Music](./generate-music.md)                     | Makes background music from a description                                    | `media.audio`                      | Paid                              |
| [Analyze Media](./analyze-media.md)                       | Transcribes speech with word timings, or reads a file's details              | `data`                             | Paid, or free                     |
| [Concatenate Video](./concatenate-video.md)               | Joins clips into one video, with sound and subtitles                         | `media.video`                      | Free                              |
| [Render Timeline](./render-timeline.md)                   | Renders a timeline into a finished video                                     | `media.video`                      | Free                              |
| [Compose Timeline](./compose-timeline.md)                 | Places pictures, clips, sounds, drawings, words and captions from a plan     | `timeline`                         | Free                              |
| [Prepare Drawings](./prepare-drawings.md)                 | Checks the drawings a model made and gathers the usable ones                 | `data`                             | Free                              |
| [Preview Drawings](./preview-drawings.md)                 | Makes one picture of a set of drawings                                       | `media.image`                      | Free                              |
| [Generate Motion Graphic](./generate-motion-graphic.md)   | Has a model write an animated title, chart, diagram or any motion graphic    | `data`                             | Paid, or your ChatGPT/Claude plan |
| [Render Motion Graphic](./render-motion-graphic.md)       | Renders a motion graphic into a clip, transparent or not                     | `media.video`                      | Free                              |
| [Cut Out Background](./cut-out-background.md)             | Makes a picture's plain background see-through                               | `media.image`                      | Free                              |
| [Export Subtitles](./export-subtitles.md)                 | Makes an SRT or VTT file from word timings                                   | `file.subtitles`                   | Free                              |
| [Human Input](./human-input.md)                           | Pauses for you to type or paste something                                    | `text`, `data`                     | Free                              |
| [Human Timeline Edit](./human-timeline-edit.md)           | Pauses for you to edit a timeline by hand                                    | `timeline`                         | Free                              |
| [Automate Browser](./automate-browser.md)                 | Lets Codex or Claude use a signed-in browser to do a task, or download files | `data`, audio, image, video, lists | Uses your ChatGPT or Claude plan  |
| [Generate Video with Flow](./generate-video-with-flow.md) | Makes clips in Google Flow with Codex or Claude and your Flow accounts       | video list                         | Uses your Flow credits            |

**Paid** types call an AI service that bills you directly, and are limited by the run's
[budget](../runs/budget-and-costs.md). **Free** types run inside Reelcraft. See
[Costs](../reference/costs.md) for the details.

Add a stage by selecting **Add stage** on the canvas and picking its type. See
[Blueprints](../blueprints/blueprints.md#add-a-stage).

## How a blueprint usually fits together

A typical video blueprint chains these types:

1. **Generate Text** plans the scenes, as `data` with a list, and another **Generate Text** writes the
   script as `text`.
2. **Generate Image** or **Generate Video** makes the visuals, once per scene, using
   [iterate](../blueprints/iterate-conditions-approval.md#iterate).
3. **Generate Speech** records the voice-over from the script.
4. **Analyze Media** gets word timings from the voice-over, and **Export Subtitles** or the timeline's
   captions use them.
5. **Generate Text** (as `timeline`) or **Human Timeline Edit** arranges everything on a timeline.
6. **Render Timeline**, or **Concatenate Video**, makes the finished video.

Stages that don't need each other, such as the voice-over and the visuals, can run at the same time: see
[Parallel stages](../blueprints/parallel-stages.md).

See [Assembly](../video/assembly.md).
