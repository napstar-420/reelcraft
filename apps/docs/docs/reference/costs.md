---
title: Costs
description: Which parts of Reelcraft cost money, who bills you, and which are free.
---

Reelcraft itself is free. The only costs are the AI services you connect, and each bills you directly.
Reelcraft estimates the cost before each paid call and keeps a run within its
[budget](../runs/budget-and-costs.md), but it can't know your providers' current prices, so check them
on their sites.

## What costs money

| What                                                                                  | Billed by                  | How                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| [Generate Text](../stage-types/generate-text.md) with an OpenRouter model             | OpenRouter                 | By the amount of text sent and received                                 |
| [Generate Image](../stage-types/generate-image.md) with an OpenRouter model           | OpenRouter                 | Per image, by the model                                                 |
| [Generate Video](../stage-types/generate-video.md) (fal)                              | fal                        | Per clip. Usually the biggest cost                                      |
| [Generate Speech](../stage-types/generate-speech.md) (ElevenLabs)                     | ElevenLabs                 | By the amount of text                                                   |
| [Analyze Media](../stage-types/analyze-media.md) with **Transcribe align** (Deepgram) | Deepgram                   | By the length of the audio                                              |
| [Quality control](../blueprints/quality-control.md)                                   | The judge model's provider | One call per scoring, and a transcription if the judge can't hear audio |

Every attempt costs, including ones that fail a check, fail quality control or are rejected. Redoing
work costs again.

## What uses your ChatGPT plan

**Codex** and **ChatGPT** models, including [Automate Browser](../stage-types/automate-browser.md), use
your ChatGPT plan instead of a per-use bill. They count against your plan's own limits. See
[Connect Codex](../codex.md) and [BrowserOS Neo](../browseros-neo.md).

## What is free

- [Concatenate Video](../stage-types/concatenate-video.md), [Render Timeline](../stage-types/render-timeline.md)
  and [Export Subtitles](../stage-types/export-subtitles.md): they run on your computer. They use its
  processor and time, not money.
- [Analyze Media](../stage-types/analyze-media.md) with **Probe**.
- [Human Input](../stage-types/human-input.md) and [Human Timeline Edit](../stage-types/human-timeline-edit.md),
  and waiting for approval.
- [Checks](../blueprints/checks.md).
- The **Fake (test)** provider, so [dry runs](../runs/dry-runs.md) of everything except Deepgram
  transcription cost nothing.
- Storing your channels, blueprints and files.

## Keeping spending in check

- Try blueprints with a [dry run](../runs/dry-runs.md), and one stage at a time from the
  [canvas](../runs/canvas-runs.md).
- Set a sensible **Run cap** and a [stage cap](../channels/defaults.md#stage-cap-usd).
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) before expensive
  stages.
- Set a spending limit with each provider too. Most let you.
- Use the cost shown when you [reject](../runs/when-a-run-needs-you.md#rejecting) an output or
  [retry](../runs/retries.md) a stage: it estimates what redoing the work will cost.
