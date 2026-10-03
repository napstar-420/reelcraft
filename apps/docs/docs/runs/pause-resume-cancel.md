---
title: Pause, resume and cancel
description: Stop a run for a while, carry on later, or end it for good.
---

## Pause

**Pause** holds a running run. You can use it, for example, when you've spotted a mistake and want to stop
spending while you think.

- Select **Pause** on the run page, or the pause button on the run's row in the
  [Runs list](./runs-list.md). It's only there while the run is **Running**.
- The stage that is working is allowed to finish its current attempt; no new stage starts. The run's status
  becomes **Paused Manual**.

## Resume

**Resume** carries on from where the run stopped. It's available for:

- a run you paused (**Paused Manual**);
- a run that paused for money (**Paused Budget**). Raising the budget does this for you. See
  [Budget and costs](./budget-and-costs.md);
- a **Failed** run, once you've fixed the cause, such as a missing model. Everything that worked is kept
  and the stage that failed tries again.

A failed run can only resume when its failed stage is the one in progress. If it can't, Reelcraft says
there is **no resumable cursor execution**: use [Retry](./retries.md) on the stage or **Rerun** instead.

## Cancel

**Cancel run** stops a run for good. Reelcraft asks first: **Cancel this run? This stops the run
permanently and can't be undone.** Select **Yes, cancel run**, or **Keep running**.

- Anything already made is kept, and you can still look at it.
- A cancelled run can't be resumed, but you can **Rerun** it to start a new one.
- Money already spent stays spent. A call to a provider that was in progress may still be charged.

Cancel is available while a run is waiting to start, running, paused for any reason, or failed.

A run you want to delete along with its blueprint or channel must be finished or cancelled first. See
[Blueprints](../blueprints/blueprints.md#delete-a-blueprint).

## Which buttons when

| The run is…                       | You can                                                   |
| --------------------------------- | --------------------------------------------------------- |
| Running                           | Pause, Cancel, Raise budget                               |
| Paused Manual                     | Resume, Cancel, Raise budget                              |
| Paused Budget                     | Raise budget (continues), Resume, Retry a stage, Cancel   |
| Paused Approval or Paused Input   | Do what it asks, Retry a stage, Cancel, Raise budget      |
| Failed                            | Resume, Retry a stage, Raise budget, Cancel               |
| Completed                         | Retry a stage, Rerun                                      |
| Cancelled                         | Rerun                                                     |

See [Run statuses](../reference/run-statuses.md).
