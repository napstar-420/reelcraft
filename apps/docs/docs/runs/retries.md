---
title: Continue and re-run work
description: Preserve passed items, regenerate a stage or item, or explicitly rebuild a blueprint.
---

The canvas and run page share these actions, eligibility rules and confirmations.

| Action                  | What executes                                                             | What is preserved or invalidated                                                               |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Run stage**           | Only the selected eligible stage                                          | Prerequisites must already be ready; they never launch automatically                           |
| **Continue stage**      | Unfinished items or interrupted work in that stage                        | Passed items and saved candidates are preserved                                                |
| **Re-run stage**        | The selected stage and all its items                                      | Completed items are regenerated; affected descendants become stale without executing           |
| **Re-run item**         | One item                                                                  | Other items remain; observed item consumers, including sequential item consumers, become stale |
| **Run blueprint**       | All unfinished, failed or stale required work                             | Current completed work stays passed                                                            |
| **Re-run blueprint**    | Every required stage and item                                             | Explicit full regeneration, with cost/rebuild confirmation; history remains                    |
| **Run through stage**   | Selected stage and required unfinished prerequisites                      | Explicitly expands the scope upstream                                                          |
| **Rebuild descendants** | Selected work, affected descendants and required unfinished prerequisites | Explicitly expands downstream; independent current branches remain                             |

**Run through stage** and **Rebuild descendants** are in the stage's **More execution actions** menu.
They are separate from ordinary **Run stage**.

## Partial iteration

For **6/14 completed**, choose **Continue stage** to submit eight unfinished items in the same run.
Continue uses persisted item states, including non-consecutive successes. Item values and dependency
identity must still match the pinned snapshot; equal item counts alone do not establish compatibility.
If they differ, explicitly rebuild rather than silently mixing outputs.

**Re-run stage** warns that all completed items will regenerate. To replace only one output, open
**View output**, find the item and select **Re-run item**. Its confirmation lists affected consumers.

Progress counts and attempt counts are separate: six completed items can have more than six attempts.
Earlier artifacts, attempts and spending remain in history after any rerun.

## Confirming a rebuild

The execution plan lists exactly which stages execute, which completed outputs stay, which consumers
become stale and historical costs. New work may cost more; unrun stages are unpriced. Confirmations
are bound to the selected action, items, snapshot, concurrency setting and run revision. A changed run,
duplicate confirmation or concurrent resume requires a fresh plan.

Definition changes retain explicit **Use existing outputs** and rebuild choices. Continue ordinarily
uses the pinned snapshot. **Check existing output** can apply check/QC-only edits to a stored
non-iterating output without generating it again. QC may cost money.

## Automatic retries

Crash retries, check feedback and quality-control feedback retain their separate limits. See
[Stages](../blueprints/stages.md#three-kinds-of-try-again). A pause stops admission of a new generation
attempt after the current attempt finishes. A human rejection explicitly starts another attempt.

See [Pause, resume and cancel](./pause-resume-cancel.md) for interrupted requests and possible charges.
