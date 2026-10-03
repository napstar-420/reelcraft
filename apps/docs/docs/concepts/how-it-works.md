---
title: How Reelcraft works
description: The big picture, from a channel to a finished video.
---

Reelcraft makes videos by following **recipes** you build. Here is how the pieces fit together.

## The pieces

**Channel**: the home for one kind of video you make, such as a YouTube channel. Everything below lives
inside a channel: its blueprints, characters, assets and runs. See [Channels](../channels/channels.md).

**Blueprint**: a recipe for a video. It's a list of **stages** that run in order. See
[Blueprints](../blueprints/blueprints.md).

**Version**: every time you save a blueprint, Reelcraft keeps a copy that never changes, numbered like
`v1.3`. Runs always use a version. See [Versions](../blueprints/versions.md).

**Stage**: one step of a blueprint. Each has a **type**, such as writing text, making an image or joining
clips, and takes inputs from earlier stages. See [Stages](../blueprints/stages.md) and
[Stage types](../stage-types/index.md).

**Run**: one go at making a video from a version of a blueprint, with the inputs and budget you give it. See
[Starting a run](../runs/starting-a-run.md).

**Output**: what a stage makes: text, structured data, an image, a video, speech, subtitles or a timeline. The
last video made is the run's **final video**. See [Outputs](../blueprints/outputs.md).

## How it fits together

```text
Channel
 ├─ Characters and assets   (reusable, shared by the channel's blueprints)
 └─ Blueprint
     ├─ Version v1.0, v1.1, v1.2 …   (saved copies)
     │    ├─ Inputs      what a run asks you for
     │    ├─ Defaults    models, retries, caps, format
     │    └─ Stages      write script → make images → voice-over → assemble
     └─ Runs            each one uses a version, and makes a video
```

## What happens in a run

1. You pick a blueprint version and fill in its **inputs**: a topic, a script, a photo.
2. Reelcraft runs the **stages** one at a time. Each stage reads what it needs, perhaps the previous
   stage's output, and makes its own.
3. After a stage, Reelcraft can **check** its output automatically, ask an AI judge to score it
   (**quality control**), or pause for **your approval**. If the output isn't good enough, the stage tries
   again with feedback.
4. Money is controlled by a **budget**. If a step would go over it, the run pauses until you raise it.
5. The run ends **Completed**, with its outputs and, if it made one, a final video.

## What you control, and where

| You want to…                              | Look at                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Choose the AI model for each kind of work | [Defaults](../channels/defaults.md) and [Models](../blueprints/models.md)                 |
| Write instructions for an AI model        | [Prompts](../blueprints/prompts.md)                                                       |
| Feed one stage with another's output      | [Connecting stages](../blueprints/connecting-stages.md)                                   |
| Repeat a stage for every scene            | [Iterate](../blueprints/iterate-conditions-approval.md#iterate)                           |
| Catch bad results automatically           | [Checks](../blueprints/checks.md) and [Quality control](../blueprints/quality-control.md) |
| Review results yourself                   | [Human approval](../blueprints/iterate-conditions-approval.md#human-approval)             |
| Keep the same face in every image         | [Characters](../channels/characters.md)                                                   |
| Put clips, music and captions together    | [Assembly](../video/assembly.md)                                                          |
| Limit what a run can spend                | [Budget and costs](../runs/budget-and-costs.md)                                           |
| Try things out for free                   | [Dry runs](../runs/dry-runs.md)                                                           |

New words are explained in the [Glossary](./glossary.md).
