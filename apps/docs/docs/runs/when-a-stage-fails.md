---
title: When a stage fails
description: Read why a stage or a run failed, and what to do about each kind of failure.
---

When a stage can't finish, the run's status becomes **Failed** and the stage shows **Failed**. To find out
why, open the stage's **Attempts** and read the log. The last lines say what happened, such as **Stage
failed: …**.

Reading it is easier if you know the kinds of failure.

## What the attempts say

Each attempt has an outcome:

| Outcome                 | Meaning                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| **Success**             | It worked                                                                  |
| **Awaiting Approval**   | It worked and is waiting for your review                                   |
| **Check Failed**        | Its output failed a [check](../blueprints/checks.md)                       |
| **Qc Failed**           | [Quality control](../blueprints/quality-control.md) scored it too low      |
| **Qc Error**            | The quality control judge couldn't produce a score                         |
| **Qc Budget Exhausted** | The judge would have gone over its cap                                     |
| **Provider Error**      | The AI service returned an error                                           |
| **Provider Timeout**    | The AI service didn't answer in time                                       |
| **Infra Error**         | Something went wrong inside Reelcraft                                      |
| **Budget Blocked**      | The next step would have gone over a [budget](./budget-and-costs.md) limit |
| **Rejected**            | You rejected it                                                            |
| **Cancelled**           | The run was cancelled                                                      |

An attempt that failed isn't always the end: Reelcraft tries again, within the limits described in
[Stages](../blueprints/stages.md#three-kinds-of-try-again), and the stage only fails once those run out.

## Common failures and fixes

### check_failed after N attempts

The output kept failing a check. The message names the checks. Open the attempts to see each one's
message.

- If the checks are right, improve the stage's prompt, using the failure messages, or raise **Max check
  attempts**.
- If a check is wrong, such as a limit that's too tight, fix it in the blueprint.
- A check that is itself broken, such as a script with an error, is reported as an authoring problem.

### qc_failed after N attempts

The judge kept scoring the output below the threshold, and the message ends with its last critique. Sharpen
the prompt around the critique, lower the **Threshold**, or choose **Hand off to human review** so you
decide.

### Model reported …

The model said it couldn't do the task, with a code such as `input_missing`, and a reason. Fix the input or
the instructions it names. See [Prompts](../blueprints/prompts.md#when-the-model-cant-do-the-job).

### QC could not run

Quality control itself failed to run, for example because the judge model can't hear audio and no Deepgram
key is set. The message says why.

### Provider errors and timeouts

The AI service refused or didn't answer. Typical causes are a missing or wrong key, an account out of
credit, a model that's no longer available, or the service being down.

- Check the key in **Settings**. See [AI provider keys](../provider-keys.md).
- Check you have credit with the provider.
- Try again later, then **Resume** the run.

A stage retries these automatically up to its **Retries**. After that, the stage fails.

### unknown provider "undefined"

The stage has no model. Set one, or a default. See [Models](../blueprints/models.md).

### The run paused instead of failing

Running into a budget limit pauses the run, it doesn't fail it. See
[Budget and costs](./budget-and-costs.md).

## After a failure

1. Fix the cause: the prompt, the check, the key, the budget.
2. If you changed the blueprint, remember a run uses the version it started with. To use your changes,
   save a new version and **Rerun**, or [run stages from the canvas](./canvas-runs.md).
3. If you only fixed something outside the blueprint, such as a key or your credit, select **Resume**, or
   **Retry** the failed stage. See [Retries](./retries.md).

Still stuck? See [Troubleshooting](../troubleshooting.md).
