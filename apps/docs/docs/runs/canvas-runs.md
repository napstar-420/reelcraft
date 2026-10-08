---
title: Canvas runs
description: Try stages one at a time while you build, without saving a version or starting from scratch.
---

While you build a blueprint, you don't want to rerun everything after each small change. The **Run**
tab beside the canvas lets you run a blueprint, or one stage of it, and see the results next to the
canvas. Each stage card shows the same status, so you can watch a run without leaving the diagram.

## The first run

With no runs yet, the tab says **No runs yet**. Select **Run blueprint**, fill in the inputs and start a
run, as in [Starting a run](./starting-a-run.md).

After that, the tab follows the latest run.

## What the tab shows

- The run's short id, as a link to its [run page](./run-page.md), with its status and how long it has
  taken, and a bar showing what it has spent against the run's cap.
- **Run all**, **Cancel run**, **Pause** and **Resume**, whichever apply.
- A list of the stages, each with a status dot, its label and buttons. Select a label to open that stage
  in the **Stage** tab.
- **Blueprint output**: the result of the last stage, once it has run.
- **Memory**: the values stages have saved. See
  [Connecting stages](../blueprints/connecting-stages.md#memory).

## Run all

**Run all** starts a new run of the blueprint as it is on the canvas, using the same inputs as the
last run. It **reuses** every stage at the start of the blueprint that hasn't changed since, so only the
stages from the first change onwards run again. Reused stages are marked **Reused**.

Only the unbroken run of unchanged stages from the first stage is reused. If you change stage 3, stages
3 and later run again, even if some of them wouldn't be affected. A stage the last run didn't finish
(waiting for your review or input, failed, cancelled or never reached) isn't reused either, so it runs
again. The stage's **Attempts** log says why, for example _Re-running "Script": it was awaiting approval
in the source run_.

**Rerun** on the run page and **Run up to** in the run dialog don't reuse anything: they start a fresh run
from the first stage.

## Run only the first stages

Before a blueprint has any run, there is no play button on the stages yet. Select **Run**, then pick a stage
under **Run up to**. Reelcraft runs from the first stage to that one and skips the rest. Once the run
exists, use the play button on any stage to re-run it (below).

## Run a single stage

Select the play button next to a stage, in the **Run** tab or on its card, to run just that stage. Reelcraft reuses everything before it,
runs the stage fresh, and stops right after it. Use it to tune one prompt without paying for the stages
around it.

If an earlier stage can't be reused, for example because it is still waiting for your review, running this
stage would have to run that one again first. Reelcraft doesn't do that silently. It asks, with a message
that starts **Running "Stage" re-runs an earlier stage** and names the stage and the reason, such as
_"Script" is waiting for your review_. Your choices:

- **Review _Stage_**: opens the approval so you can approve it, then run the stage again to build on its
  output. It only appears when that stage is waiting for your review in the run on the canvas.
- **Run anyway (also re-runs _Stage_)**: starts the run, which runs the earlier stage again first and
  spends on it again.
- **Cancel**: starts nothing.

Before you select it, the play button's tooltip warns you in the same way, for example _Run this stage.
"Script" is waiting for your review, so it would run again first._

While a stage is running, its button on the card turns into a stop button, labelled **Cancel run**. There's no way
to stop just one stage: it cancels the whole run, and Reelcraft asks first: **Cancel this run? This
stops the whole run, not just one stage. It can't be undone.**

## Unsaved changes

You can run while the canvas has unsaved changes. Reelcraft saves a temporary copy of the canvas as it
is and runs that. It doesn't appear in the **Versions** menu, and it isn't a new version.

Select **Save** when you're happy. [Versions](../blueprints/versions.md) explains the difference.

The blueprint must be **Runnable** for any of these to start.

## The stage buttons

- **View output** (the eye): the stage's current output.
- **Attempts** (the clock): every attempt, with its log.
- **Review** (on the card) or **Review output** (in the tab): appears on the stage waiting for your approval. See
  [When a run needs you](./when-a-run-needs-you.md).
