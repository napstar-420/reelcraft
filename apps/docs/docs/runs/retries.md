---
title: Retries
description: Redo a stage that failed or that you want different, without starting the whole run over.
---

There are three ways to redo work, depending on how much you want to keep.

## Automatic tries

Before you do anything, a stage already tries again by itself in some cases. A crash uses its **Retries**,
a failed check uses **Max check attempts** and a low quality control score uses **Max attempts**. A
rejected output, which is your decision, is not limited. See
[Stages](../blueprints/stages.md#three-kinds-of-try-again).

## Redo a stage in the same run

Use this when one stage failed, or when you don't like what it made and want to keep everything else.

1. On the [run page](./run-page.md), find the stage. A stage that finished shows **Re-run**, one that
   failed shows **Retry**.
2. Open its menu and choose how much to redo:

   | Choice                              | What it does                                                    |
   | ----------------------------------- | --------------------------------------------------------------- |
   | **With stages that use its output** | Redoes this stage and the later stages that use its output      |
   | **Only this stage**                 | Redoes just this stage. Later stages keep their current outputs |
   | **This and all later stages**       | Redoes this stage and every stage after it                      |

3. A summary appears, with the **Affected stages**, what is **Already spent** and the **Estimated rerun
   cost**. Select **Confirm re-run**, or **Cancel**.

The run then continues from that stage. Earlier attempts stay in the stage's **Attempts** list. The
stages whose outputs depended on the old result are marked **Stale** until they run again.

Choosing **Only this stage** can leave later stages built on the old output. Use it when you know the
change won't matter to them.

This is available from the paused states, **Failed** and **Completed**. It isn't available while a run
is **Running** or after it was **Paused** by hand. See [Run statuses](../reference/run-statuses.md).

## Resume

A **Failed** run can sometimes simply **Resume** where it stopped, after you fix the cause, for example by
raising the budget, adding a model or topping up credit. It keeps all the work that succeeded. See
[Pause, resume and cancel](./pause-resume-cancel.md).

## Start over with Rerun

**Rerun** starts a brand-new run from the very beginning, once the old one is **Completed**,
**Failed** or **Cancelled**. It uses the same blueprint version, the same inputs and the same budget cap.

If the blueprint uses a [character](../channels/characters.md), the new run uses the character **as it
is now**, including any changes since the old run, so a rerun after improving a character's images uses
the new ones.

Nothing is reused: every stage runs again and is paid for again. To redo only part, use the section
above.

## Reusing work while you build

The [**Run** tab on the canvas](./canvas-runs.md) offers a middle path: **Run all** and single-stage runs
start a new run that reuses the unchanged stages from the previous one.
