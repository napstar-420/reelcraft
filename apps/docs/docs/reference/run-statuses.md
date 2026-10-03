---
title: Run statuses
description: What every status of a run, a stage and an attempt means, and what you can do from each.
---

Statuses appear as coloured badges on the [Runs list](../runs/runs-list.md), the
[run page](../runs/run-page.md) and the canvas [run panel](../runs/canvas-runs.md).

## Run statuses

| Status              | Meaning                                                                       | You can                                            |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| **Created**         | The run exists but hasn't started, for example while files upload             | Wait, or cancel                                    |
| **Running**         | Stages are being carried out                                                  | Pause, cancel, raise the budget                    |
| **Paused Budget**   | The next step would go over the run's or a stage's spending limit             | Raise the budget (it continues), resume, retry a stage, cancel |
| **Paused Approval** | A stage with human approval is waiting for your review                        | Review output, retry a stage, cancel               |
| **Paused Input**    | A Human Input or Human Timeline Edit stage is waiting for you                 | Provide input or open the editor, retry a stage, cancel |
| **Paused Manual**   | You paused it                                                                 | Resume, cancel, raise the budget                   |
| **Failed**          | A stage couldn't finish                                                       | Resume, retry a stage, rerun, raise the budget, cancel |
| **Completed**       | Every stage finished                                                          | Rerun, retry a stage                               |
| **Cancelled**       | You stopped it for good                                                       | Rerun                                              |

Retrying a stage isn't offered on a run you paused yourself, because that would quietly resume it. Resume
it first.

A run can only move between these statuses in the ways above: for instance, you can't pause a run that's
paused, and you can't resume a completed one.

**Completed**, **Failed** and **Cancelled** are the finished statuses. A run waiting for you or for money
isn't finished, and blocks deleting its blueprint or channel until it is. See
[Pause, resume and cancel](../runs/pause-resume-cancel.md).

## Stage statuses

| Status                | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| **Pending**           | Hasn't started yet                                                  |
| **Running**           | Working on it                                                       |
| **Awaiting Approval** | Finished, and waiting for your review                               |
| **Awaiting Input**    | Waiting for you to provide something                                |
| **Passed**            | Finished successfully                                               |
| **Failed**            | Couldn't finish, after its retries                                  |
| **Stale**             | Its output was made from something that has since been redone       |
| **Skipped**           | It didn't run, for example because its **Enabled when** condition wasn't met, or the run stopped before it. It costs nothing. |
| **Cancelled**         | The run was cancelled before it finished                            |

## Attempt outcomes

Each try a stage makes has an outcome. See
[When a stage fails](../runs/when-a-stage-fails.md#what-the-attempts-say).
