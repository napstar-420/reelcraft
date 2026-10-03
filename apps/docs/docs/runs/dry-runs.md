---
title: Dry runs
description: Try a blueprint end to end without spending money, using placeholder results.
---

A **dry run** goes through a blueprint's stages like a real run, but every AI model is replaced by
Reelcraft's free **test provider**. Nothing is charged. Use it to check that a blueprint's stages are
connected correctly before you pay for a real run. It has limits: see
[What a dry run can't test](#what-a-dry-run-cant-test).

## Start a dry run

1. Open the blueprint's canvas. Under **Save & run**, select **Dry run (fake provider)**.
2. In the dialog, titled **Dry run**, fill in the inputs, as for a [real run](./starting-a-run.md).
   Uploads work the same way.
3. The **Budget cap (USD)** starts at $1. Keep it small.
4. Select **Start dry run**.

Like a real run, a dry run needs a saved, runnable version.

## What is different

- **Text, image, video and speech** stages, and the **quality control judge**, use the test provider.
  They return placeholder results that look right but aren't real: a plain picture, a short test clip,
  made-up text.
- **Human stages still pause for you**: Human Input, Human Timeline Edit and approvals work exactly as
  in a real run, because you're the one acting.
- **Local stages run for real**: Concatenate Video, Render Timeline and Export Subtitles do their
  actual job on the placeholder media, and cost nothing either way.
- **Analyze Media** keeps its own model. With **Probe**, nothing is paid. With **Transcribe align**,
  it still calls Deepgram. See [Analyze Media](../stage-types/analyze-media.md).

## What a dry run can't test

The placeholder results are very simple, so some things fail in a dry run that would work in a real one:

- **Structured data.** The test provider can only return plain text. A **Generate Text** stage whose output
  is `data` fails its schema check (`$: must be object`) and the dry run stops there. This includes any
  blueprint that plans its scenes as `data`.
- **Media checks.** A placeholder image is a single pixel, a placeholder speech file is silence with no
  length, and placeholder video is a short test clip. Checks that read a file's details, such as `wpm`,
  `duration_range` and `media_format`, fail on them, for example _wpm: artifact has no usable probe
  duration_.
- **Content checks and quality control.** Checks and judging that look at the _content_ behave differently
  on made-up content.

A dry run is best for checking that stages are connected and that the blueprint reaches its end, for
blueprints built from text, image, video and speech stages. To try a stage that a dry run can't handle,
use the [canvas run panel](./canvas-runs.md) with a real model, or temporarily turn off the check that fails.

## Finding dry runs afterwards

Dry runs are hidden from the [Runs list](./runs-list.md) so they don't crowd out your real work. Turn
on **Show test runs** to see them. They're marked with a **dry run** badge.

## Dry runs on the canvas

The [run panel](./canvas-runs.md) on the canvas starts real runs. To try a blueprint for free, use the
**Dry run (fake provider)** button under **Save & run**.
