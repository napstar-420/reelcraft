---
title: Quality control
description: Have an AI model score a stage's output against your criteria, and redo it when the score is too low.
---

**Quality control** (QC) asks a second AI model, the **judge**, to look at a stage's output and score
it from 0 to 100 against criteria you write. If the score is below your **threshold**, the stage
tries again with the judge's critique added to its prompt.

Use it for things a [check](./checks.md) can't measure, such as "the script is funny and in plain
language" or "the image shows a single person in a kitchen". It costs money, because the judge is a
paid model call, so reserve it for the stages where quality really matters.

Quality control is available on text, data, timeline, image and audio outputs. It isn't available on
**video** outputs, where [human approval](./iterate-conditions-approval.md#human-approval) takes
its place, or on **Human Input** stages.

## Add quality control

1. Open the stage and go to **Checks & Quality control** → **Quality control**.
2. Select **+ add quality control**.
3. Fill in the settings below, starting with **Criteria**, **Threshold** and the judge's **Model**.

Select **Remove quality control** to take it off.

## Settings

- **Criteria**: what a passing output looks like, in plain words. Be specific: "A script of about 30
  seconds, with a hook in the first sentence and no jargon" beats "a good script".
- **Threshold**: the lowest score, from 0 to 100, that passes.
- **Max attempts**: how many times the output may be scored too low before Reelcraft gives up. Empty
  means 3. This is separate from **Retries**, which only cover crashes.
- **When attempts run out**: what happens after the last failed attempt:
  - **Fail the stage**: the stage and the run fail.
  - **Hand off to human review**: the run pauses so you can look at the last output yourself. You
    either approve it or reject it with a note, which becomes feedback for the next attempt. See
    [When a run needs you](../runs/when-a-run-needs-you.md).
- **Include inputs**: also show the judge what went into the stage, its slots and context. Useful when
  the judge needs the original request to decide, such as to check a summary against its source.
- **Include transcript**: for **Generate Speech** outputs only. See below.
- **Model**: the judge. It's required, and it doesn't use your [defaults](../channels/defaults.md);
  pick a capable text model. See [Models](./models.md).
- **Dimensions**: optional.

### Dimensions

Dimensions split the judgement into named parts, such as `clarity` and `uk_relevance`, each with its
own weight.

1. Select **+ Add dimension**.
2. Enter a **Dimension key**, the weight and a description of **What the judge should look for…**.

The judge scores each dimension separately, and the stage's score is their weighted average. Each
dimension shows what share of the score it carries, for example **40% of score**. Select the bin to
remove one.

## What the judge sees

The judge sees only:

- your **Criteria** and **Dimensions**;
- the stage's **output**: its text or data, or for an image the picture itself;
- the output's technical details for media, such as its length;
- the stage's inputs, only if you ticked **Include inputs**;
- for audio, the transcript or the audio itself, if you ticked **Include transcript**.

It never sees the stage's own prompt, which model made the output, what it cost, how many attempts
there have been, earlier verdicts or the threshold. This keeps the judgement honest.

On a failed score, the judge's **critique** is added to the next attempt's prompt, so the stage knows
what to fix. See [Prompts](./prompts.md#when-an-attempt-is-rejected).

## Include transcript

A judge model reads text, not sound. For a **Generate Speech** stage, tick **Include transcript** to
let the judge assess what was said:

- If the judge model can listen to audio, it **listens to the audio itself**.
- Otherwise, if you've added a Deepgram key in **Settings**, Deepgram **transcribes the audio** for the
  judge. This is paid, and its cost counts toward the stage's quality control cap.
- If neither is possible, the box is greyed out with the reason: **This judge model can't listen to
  audio and no Deepgram key is set (Settings → Provider keys).**

If the option is on and later becomes impossible, the quality control fails to run and the stage
fails with that reason. The blueprint also shows **Include transcript only works on an audio
(media.audio) output** if you use it on any other output.

## Cost

Each scoring is a call to the judge model. A stage that fails its score several times makes several
judge calls as well as several generations.

Set a **Quality control cap (USD)** under **Execution (retry, budget)** to limit what the judge may
spend on a stage in one run. If the next judgement would go over, the stage fails (**QC budget
exhausted**). See [Budget and costs](../runs/budget-and-costs.md).

## When the judge itself fails

If the judge can't produce a score, for example because it timed out or answered with something
unreadable, Reelcraft asks it again a couple of times. If it still fails, the stage fails and says
that quality control couldn't run. Re-prompting the stage wouldn't help, so it doesn't.

## A good setup

- Put the cheapest checks first as [checks](./checks.md): length, format, banned words.
- Add quality control only for what you can't test by rule.
- Keep **Max attempts** small, and choose **Hand off to human review** where you'd rather decide
  yourself than fail a long run.
