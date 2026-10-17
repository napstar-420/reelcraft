---
title: Pause, resume and cancel
description: Stop admitting work, preserve progress, and continue the same run later.
---

The canvas toolbar, canvas **Run** tab and run page use the same controls and run records.
Moving between them preserves the selected run and its progress.

## Pause and resume

**Pause** changes Running to **Pausing**. Active attempts, including their checks and quality control,
finish; no new stages, iteration items or generation retries start. Once active work drains, the run
becomes **Paused Manual**. **Resume** continues the same execution scope using the pinned snapshot.
It does not expand a stage-only action into the whole blueprint.

Stage execution controls are hidden while Running, Pausing or Cancelling. The server also rejects
new execution actions during those transitions. Output previews and attempt history remain available.

## Cancel and continue

**Cancel run** stops execution and preserves finished outputs, spending and saved approval/input
candidates. The run enters **Cancelling** while provider requests and reservations are reconciled,
then becomes **Cancelled**. Cancellation is resumable; it does not erase progress.

Use **Continue run** to continue the saved execution scope, or **Continue stage** to continue only the
selected interrupted stage. Use **Run blueprint** to expand to all unfinished blueprint work. For an iterating stage with **6/14 completed**, Continue preserves those
six artifacts and submits the other eight items. Passed items need not be consecutive.

Provider cancellation is best effort. If cancellation cannot be confirmed, restarting an unfinished
request may cause additional charges. Review that warning, acknowledge the risk, and confirm the new
execution plan before restarting. Late results and delayed cancellation events from an earlier
execution generation cannot replace resumed work.

A saved approval or input request remains available when continuation parks on it again. Answer that
request instead of regenerating its candidate.

## Other pauses

- **Paused Budget**: raise the run or stage cap, then resume. See [Budget and costs](./budget-and-costs.md).
- **Paused Quota**: a scheduled wakeup resumes after provider quota resets. Manual resume replaces
  that scheduled recovery; a delayed old wakeup cannot start a second execution.
- **Paused Approval / Paused Input**: independent runnable branches finish before the run parks.
  Descendants of a waiting stage stay blocked until you answer.
- **Failed**: independent branches continue until runnable work settles. Resume retries unfinished
  work within the saved scope; **Re-run stage** explicitly regenerates a selected stage.

**Idle** means the selected scope finished while other required blueprint work remains. Use
**Run blueprint** to expand to all unfinished work. **Completed** means all required work finished.
