---
title: Run page
description: Follow a run as it happens, and see its budget, its stages and the finished video.
---

Open a run from the [Runs list](./runs-list.md), from **Home**, from a channel's **Runs** tab, or
right after you start it. The page updates by itself while the run is going.

The page has the header across the top, every stage on the left, the selected stage in the middle,
and the assistant on the right (the same chat as on every page).

## The header

- The blueprint's name and the run's short id (such as `#a1b2c3d4`), with a coloured status. See
  [Run statuses](../reference/run-statuses.md).
- One sentence saying what the run is doing right now, such as **Now: Scene images, 5 of 8 done**,
  **Stopped: Scene images failed**, or **Done: Finished: every stage is done**.
- **Stages** done, the **Time** it has been running, and the **Cost** so far against its budget, with
  **Raise budget** when raising it can help. See [Budget and costs](./budget-and-costs.md).
- A progress bar with one segment per stage: green is done, blue is running, amber is waiting for
  you and red is failed.
- **Memory** opens everything the run has saved.
- **Open blueprint** opens the blueprint. For a test run it opens that test run.
- One main button for the run's state: **Pause** while it runs, **Continue** after a failure, pause or
  stop, and **Run again** once a production run has finished. **Run again** opens the run dialog with
  this run's version, inputs and budget filled in.
- The **⋯** menu: **Stop run** and **Concurrent branches** (how many stages may run at once, default
  **2**).

Stopping keeps finished work, and you can continue later. The run shows **Pausing** while running work
finishes and **Cancelling** while interrupted requests are wound down. See
[Pause, resume and cancel](./pause-resume-cancel.md).

If the run is paused because of money, an amber line says which limit was hit:

- **Paused: the next step would go over the run budget.**
- **Paused: stage "…" reached its own Stage cap ($…).**

A run waiting for [Flow](../stage-types/generate-video-with-flow.md) credits says
**Paused: every Flow account is out of credits.** and when it resumes by itself.

## The stages

The left column lists every stage in blueprint order, grouped by phase, such as **Script**,
**Voice** and **Visuals**. Each shows a status mark (a tick when done, a spinner while running, a cross
when failed, a clock when waiting for you), its number and name, and how long it took. A stage that
repeats for many items shows how many are done, such as **5 / 8**, with a small progress bar while it
runs. After a failure, the stages that can't start yet are dimmed.

You choose the phases: set **Phase** in the stage's **Basics**. See
[Stages](../blueprints/stages.md#basics).

When a run has made a video, **Final video** sits at the top of the list and plays the video made by
the last stage, in blueprint order, that produced one. A finished run opens on it. See
[Outputs and downloads](./outputs-and-downloads.md).

## Stage details

The page opens on the stage that needs you (a failed stage, then one waiting for you), else the one
running, else the next one. Select any stage on the left to see it instead.

The top shows the stage's number, phase, how long it ran and what it cost, its status, and **Edit
stage**, which opens the stage in the blueprint editor.

- A failed stage shows **What went wrong**: the reason it failed and, for a stage that repeats, how
  many items finished and are kept. **Fix with assistant** asks the assistant to find the cause, fix
  the blueprint and re-make what the fix changes.
- A stage waiting for you has its **Review output**, **Provide input** or **Open editor** button.
- The stage buttons: **Run this stage only**, with **Run up to this stage** and **Run from this stage
  to the end** in its **⋯** menu. A production run always uses its saved version. A stage that can't
  run yet says why, such as **Waiting for …**. Stage buttons disappear while the run is Running,
  Pausing or Cancelling. See [Continue and re-run work](./retries.md).

The stage has four tabs. A running stage opens on **Live**, any other stage on **Output**.

- **Live** (**Activity** for a failed stage): what the stage is doing now, one tile per item (done,
  being made, or still to come), and the stage's events as they arrive, newest first. Select an event
  to see its details. **Show technical events** adds debug events.
- **Output**: what the stage made, such as the text, the images, the audio or the video. A stage that
  repeats for many items shows a button per item, with **✓** once it has output.
- **Attempts**: every try the stage made, newest first. Each shows its outcome, such as **Success**,
  **Check Failed**, **Qc Failed**, **Provider Error** or **Rejected**, the time and the cost. Open one
  to see the review note, the checks and quality review, **What this attempt received**, and its
  **Event log**. The attempt that became the stage's output says **Used as the stage output.**
- **Memory**: **Read** lists what the stage took from earlier stages, with a link to the stage that
  made each one. **Wrote** lists what it saved for later stages.

The event log includes the exact **prompt** that was sent to the model for the attempt, and how every
input was worked out. It's the best place to look when a stage did something you didn't expect.

## The assistant

The right column is the assistant. It knows which run and stage you have open, so you can ask
"why did this fail?" or "is this good enough?" and it looks at the stage's tries, output, pictures
and sound before it answers. It can fix the blueprint and re-make stages of this run, retry a stage,
approve or reject a review, and watch the run for you. In **Manual** mode it asks before each of
these. See [The assistant](../blueprints/assistant.md).

Hide the column with the panel button in its header, or **Cmd J**.

## Memory

The **Memory** button in the header opens every value stages have saved so far, grouped by stage.
Search and the filters narrow large collections, and **Version history** shows earlier values. If the
blueprint saves nothing, it says **No matching memory values.** See
[Connecting stages](../blueprints/connecting-stages.md#memory).
