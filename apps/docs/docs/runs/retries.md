---
title: Continue and re-run work
description: Preserve passed items, regenerate a stage or item, or explicitly rebuild a blueprint.
---

Test runs on the canvas and production runs on the run page share these actions. Production runs
always use their saved version; test runs use what's on the canvas.

| Action                             | What runs                                                          | What is kept                                              |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| **Continue**                       | Everything unfinished, failed or stale, to the end                 | Every passed stage and item                               |
| **Run this stage only**            | Just the selected stage                                            | The outputs before it are used as they are, even if stale |
| **Run up to this stage**           | Unfinished or stale stages before it, then the stage itself        | Everything after it is left alone                         |
| **Run from this stage to the end** | The stage and every stage after it, plus unfinished ones before it | Independent branches stay as they are                     |
| **Re-run item**                    | One item of an iterating stage                                     | Other items stay; stages that used the item become stale  |
| **Re-check output** (test runs)    | The checks and quality criteria on the stored output               | Nothing is generated again                                |

**Run up to this stage**, **Run from this stage to the end** and **Re-check output** are in the stage's
**⋯** menu.

## Partial iteration

For **6/14 completed**, choose **Run this stage only** (or **Continue**) to submit the eight unfinished
items in the same run.
Continue uses persisted item states, including non-consecutive successes. Item values and dependency
identity must still match the pinned snapshot; equal item counts alone do not establish compatibility.
If they differ, explicitly rebuild rather than silently mixing outputs.

**Run from this stage to the end** regenerates all items of the stage. To replace only one output, open
**View output**, find the item and select **Re-run item**. Its confirmation lists affected consumers.

Progress counts and attempt counts are separate: six completed items can have more than six attempts.
Earlier artifacts, attempts and spending remain in history after any rerun.

## Confirming

You're asked to confirm only when an action replaces work that already passed, or when a provider
request may have been charged already. The confirmation lists the stages that run, any stages that
become stale without running, and what they cost last time. New work may cost more. If the run changed
while the confirmation was open, you're asked again.

**Re-check output** applies check or quality-criteria edits to a stored, non-iterating output without
generating it again. Quality checks may cost money.

## Automatic retries

Crash retries, check feedback and quality-control feedback retain their separate limits. See
[Stages](../blueprints/stages.md#three-kinds-of-try-again). A pause stops admission of a new generation
attempt after the current attempt finishes. A human rejection explicitly starts another attempt.

See [Pause, resume and cancel](./pause-resume-cancel.md) for interrupted requests and possible charges.
