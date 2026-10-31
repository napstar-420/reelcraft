---
title: Run statuses
description: What every status of a run, a stage and an attempt means, and what you can do from each.
---

Statuses appear as coloured badges on the [Runs list](../runs/runs-list.md), the
[run page](../runs/run-page.md) and the canvas [**Test runs**](../runs/canvas-runs.md).

## Run statuses

| Status              | Meaning                                                                                                                                       | You can                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Created**         | The run exists but hasn't started, for example while files upload                                                                             | Wait, or cancel                                                    |
| **Running**         | Stages are being carried out                                                                                                                  | Pause, cancel, raise the budget                                    |
| **Idle**            | The selected scope finished; other required work remains                                                                                      | Continue, or run an eligible stage                                 |
| **Pausing**         | Active attempts are finishing; no new work is admitted                                                                                        | Wait, or cancel                                                    |
| **Cancelling**      | Interrupted provider requests and reservations are being reconciled                                                                           | Wait                                                               |
| **Paused Budget**   | The next step would go over the run's or a stage's spending limit                                                                             | Raise the budget (it continues), resume, retry a stage, cancel     |
| **Paused Approval** | A stage with human approval, or QC that could not run, is waiting for your review (also shown when an approval and an input are both waiting) | Review output (Retry QC, Approve or Reject), retry a stage, cancel |
| **Paused Input**    | A Human Input or Human Timeline Edit stage is waiting for you                                                                                 | Provide input or open the editor, retry a stage, cancel            |
| **Paused Manual**   | You paused it                                                                                                                                 | Continue, stop, raise the budget                                   |
| **Failed**          | A stage couldn't finish                                                                                                                       | Continue, run a stage, raise the budget                            |
| **Completed**       | Every stage finished                                                                                                                          | Rerun, retry a stage                                               |
| **Cancelled**       | Execution stopped with progress preserved                                                                                                     | Continue, run a stage                                              |

Stage execution actions are available only while execution is inactive and dependencies and inputs
are ready. Both the canvas and run page use the backend's action eligibility and blocking reasons.

**Completed**, **Failed** and **Cancelled** are the finished statuses. A run waiting for you or for money
isn't finished, and blocks deleting its blueprint or channel until it is. See
[Pause, resume and cancel](../runs/pause-resume-cancel.md).

## Stage statuses

| Status                | Meaning                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pending**           | Hasn't started yet                                                                                                                         |
| **Running**           | Working on it                                                                                                                              |
| **Awaiting Approval** | Finished, and waiting for your review                                                                                                      |
| **Awaiting Input**    | Waiting for you to provide something                                                                                                       |
| **Passed**            | Finished successfully                                                                                                                      |
| **Failed**            | Couldn't finish, after its retries                                                                                                         |
| **Stale**             | Its output was made from something that has since been redone                                                                              |
| **Skipped**           | It didn't run, for example because its **Enabled when** condition wasn't met, with a recorded disabled-condition reason. It costs nothing. |
| **Cancelled**         | The run was cancelled before it finished                                                                                                   |

## Attempt outcomes

Each try a stage makes has an outcome. See
[When a stage fails](../runs/when-a-stage-fails.md#what-the-attempts-say).
