---
title: When a run needs you
description: Approve or reject an output, provide an input, or edit a timeline when a run pauses for you.
---

Some runs stop and wait for you. Their status says so, and the stage waiting shows a button. A run
costs nothing while it waits, and you can leave it as long as you like.

| The run says        | Because                                                                                                                                                                      | What to do                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Paused Approval** | A stage with [human approval](../blueprints/iterate-conditions-approval.md#human-approval) finished, or [quality control could not run](#when-quality-control-could-not-run) | **Review output**                                |
| **Paused Input**    | A [Human Input](../stage-types/human-input.md) or [Human Timeline Edit](../stage-types/human-timeline-edit.md) stage is waiting                                              | **Provide input** or **Open editor**             |
| **Paused Budget**   | The next step would go over a limit                                                                                                                                          | See [Budget and costs](./budget-and-costs.md)    |
| **Paused Quota**    | Every Flow account is out of credits ([Generate Video with Flow](../stage-types/generate-video-with-flow.md))                                                                | Wait: it resumes by itself, or select **Resume** |

![A run in Paused Input, with the Open editor button on its stage](/img/usage/run-needs-you.png)

## Review output

1. On the stage waiting for approval, select **Review output**. A panel opens, titled **Review output**,
   showing the output, the attempt, what it cost and the item it belongs to when the stage iterates.
2. Look at the output. If it's no longer available, the panel says **Output is no longer available**.
3. Either:
   - select **Approve**: the run continues;
   - or select **Reject**.

### Several items waiting

When a stage that iterates runs its items [at the same time](../blueprints/iterate-conditions-approval.md#concurrency),
more than one item can be waiting for you. **Review output** shows one item and, above it, which other items
are waiting. Approve or reject it, and the sheet moves on to the next. The run carries on once no item is
left waiting; a rejected item is redone then, together with the next group.

### When quality control could not run

If the quality control judge couldn't be reached or didn't answer, the stage doesn't fail. The run pauses as
**Paused Approval** and **Review output** opens with **Quality control could not run** and the reason. The
output shown has not been judged. Choose:

- **Retry QC**: judge the same output again. Nothing is generated again, so it costs only the judge call. If
  QC still can't run, the run pauses again. If it rejects the output, the stage redoes it with the critique,
  as for any QC rejection.
- **Approve**: accept the output without a QC verdict.
- **Reject**: redo the work, as below.

### Rejecting

Rejecting redoes the work, so Reelcraft shows you what it will cost first.

1. Optionally write a **Rejection note**: _Explain what should change on the next attempt_. It's added to
   the next attempt's prompt as feedback, so be specific. See
   [Prompts](../blueprints/prompts.md#when-an-attempt-is-rejected).
2. Select **Reject**. A summary shows **Confirm rejection**, with the **Affected stages** and the
   **Estimated rerun** cost.
3. Select **Confirm rejection**, or **Back**.

Which stage is redone depends on the stage's **Retry stage** setting: by default the same stage, or an
earlier one you chose. You can reject as many times as you like, and each rejection redoes the work.

If the output came from [quality control](../blueprints/quality-control.md) running out of attempts, the
review works in the same way: approve the last output, or reject it with a note that becomes the next
attempt's feedback.

## Provide input

On a [Human Input](../stage-types/human-input.md) stage, select **Provide input**. The dialog is titled
**Provide input for** the stage:

- for a text output, type the text;
- for a data output, fill in the **Form**, or switch to **Raw JSON** to paste a value. Fields marked
  **\*** are required.

Select **Submit**. If the value fails the stage's checks, you're told why and can try again.
**Invalid JSON** appears if the JSON can't be read.

## Open editor

On a [Human Timeline Edit](../stage-types/human-timeline-edit.md) stage, select **Open editor** to
arrange the timeline. See [Timeline editor](../video/timeline-editor.md).

## Reminders

Reelcraft doesn't send notifications. Keep the run page open, or check the [Runs list](./runs-list.md)
for runs in a **Paused** state.
