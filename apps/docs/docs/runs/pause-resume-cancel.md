---
title: Pause, stop and continue
description: Pause or stop a run without losing progress, and continue it later.
---

Test runs on the canvas and production runs on the run page use the same buttons: one main button
for the run's state (**Pause** or **Continue**) and **Stop run** in the **⋯** menu.

## Pause

**Pause** changes Running to **Pausing**. Work already under way, including its checks and quality
control, finishes; no new stages, items or retries start. Then the run becomes **Paused Manual** and
the main button reads **Continue**.

Stage buttons are hidden while a run is Running, Pausing or Stopping. Outputs and attempts stay
visible.

## Stop

**Stop run** ends the run and keeps finished outputs, spending and any saved approval or input
request. The run shows **Cancelling** while provider requests are wound down, then **Cancelled**.
Stopping doesn't erase progress: you can **Continue** later. A failed run has nothing left to stop, so
**Stop run** isn't offered there.

## Continue

**Continue** keeps every passed stage and item and runs everything unfinished, failed or stale, to the
end of the blueprint. On the canvas it also applies your current edits. For an iterating stage with
**6/14 completed**, the six finished items are kept and only the other eight run, even when the finished
ones aren't consecutive.

Provider cancellation is best effort. If Reelcraft couldn't confirm that an earlier request was
cancelled, restarting it may be charged again. You're asked to acknowledge this before continuing.
Late results from the earlier attempt can't replace the new work.

A saved approval or input request is still there when the run reaches it again. Answer it instead of
generating a new candidate.

## Other pauses

- **Paused Budget**: raise the run or stage cap, then **Continue**. See [Budget and costs](./budget-and-costs.md).
- **Paused Quota**: the run continues by itself once provider quota resets, or select **Continue** to
  try now.
- **Paused Approval / Paused Input**: independent branches finish first. Stages after the waiting one
  stay blocked until you answer.
- **Failed**: independent branches finish first. **Continue** retries the failed stage and runs the
  rest.

**Idle** means a stage-only action finished while other stages are still unfinished: **Continue**
runs them. **Completed** means everything finished; start a new run to go again.
