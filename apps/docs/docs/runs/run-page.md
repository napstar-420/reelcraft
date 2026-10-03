---
title: Run page
description: Follow a run as it happens, and see its budget, its stages and the finished video.
---

Open a run from the [Runs list](./runs-list.md), from a channel's **Runs** tab, or right after you
start it. The page updates by itself while the run is going.

## The header

- **Run** and its id, with a coloured status. See [Run statuses](../reference/run-statuses.md).
- Buttons for what you can do right now:
  - **Rerun**: for a finished run. See [Retries](./retries.md#start-over-with-rerun).
  - **Pause** or **Resume**.
  - **Cancel run**, with a confirmation: **Cancel this run? This stops the run permanently and can't be
    undone.**
  See [Pause, resume and cancel](./pause-resume-cancel.md).

If an action can't be done, a red **Action failed** box says why.

## The budget bar

A bar shows how much of the run's budget is used, with a line below it such as **$1.20 spent of $5.00
budget**. **Raise budget** appears when raising it can help. See
[Budget and costs](./budget-and-costs.md).

If the run is paused because of money, an amber line says which limit was hit:

- **Paused: the next step would go over the run budget.**
- **Paused: stage "…" reached its own Stage cap ($…).**

## Final video

When a run has made a video, it plays here. It's the video made by the last stage, in blueprint order,
that produced one. See [Outputs and downloads](./outputs-and-downloads.md).

## Stages

One card per stage, in order. Each shows:

- the stage's label, and its key in small text if it differs;
- its status: **Pending**, **Running**, **Awaiting Approval**, **Awaiting Input**, **Passed**, **Failed**,
  **Stale**, **Skipped** or **Cancelled**;
- how many attempts it has made and how long it took.

Buttons on the right appear when they apply:

- **Review output**: the stage is waiting for your approval.
- **Provide input**: a Human Input stage is waiting for you.
- **Open editor**: a Human Timeline Edit stage is waiting for you.
- **Re-run** (or **Retry** for a failed stage), with a menu of what to redo. See
  [Retries](./retries.md).
- **View output**: what the stage made.
- **Attempts**: every attempt, with its log.

### Attempts

Select **Attempts** to see every try the stage made, newest first. Each shows:

- its number and its outcome, such as **Success**, **Check Failed**, **Qc Failed**, **Provider Error**
  or **Rejected**;
- who did it, and what it cost;
- the **Review note**, if someone rejected it;
- **Logs**: what happened, step by step, with times.

**Show debug events** adds finer detail. The log includes the exact **prompt** that was sent to the
model for the attempt, in its `prompt.rendered` entry, and how every input was worked out. It's the
best place to look when a stage did something you didn't expect.

## Memory

At the bottom, every value stages have saved. If the blueprint saves nothing, it says **This blueprint
doesn't write memory.** See [Connecting stages](../blueprints/connecting-stages.md#memory).
