---
title: Budget and costs
description: How Reelcraft keeps a run within a spending limit, and what to do when it pauses for money.
---

Paid stages charge your AI providers directly, so every run has a **budget cap**: the most it may spend.
Reelcraft never knowingly goes over it. A budget cap of **0** means no limit, and it is the default for new blueprints.

## The limits

- **Budget cap** (the run cap): the total for the whole run. It starts from the blueprint's
  **Run cap (USD)** and you can change it when you [start the run](./starting-a-run.md).
- **Stage cap**: the most one stage may spend. Optional. Set it per stage, or as a
  [default](../channels/defaults.md#stage-cap-usd).
- **Quality control cap**: the most a stage's quality control judge may spend. Optional. See
  [Quality control](../blueprints/quality-control.md#cost).

## How spending is controlled

1. Before a paid call, Reelcraft **estimates its worst-case cost** and checks that it fits in what is left
   of the budget (the cap, minus what's spent, minus what's set aside for calls in progress).
2. If it fits, that amount is **reserved** while the call runs.
3. When the call finishes, the **real cost** is recorded and the unused part of the reservation is released.

If the worst case doesn't fit, the call is **not made** and the run pauses. Because of this, a run can pause
a little before it has actually spent its whole cap.

Free stages, human stages and the test provider cost nothing and are never held up by the budget.

If Reelcraft can't be sure how a call ended, for example because it was cancelled before the provider
confirmed, it counts the full amount as spent to stay on the safe side.

## When a run pauses for money

The run's status becomes **Paused Budget**, and the page says which limit was reached:

- **Paused: the next step would go over the run budget.** The run cap is the limit.
- **Paused: stage "…" reached its own Stage cap ($…).** That stage's cap is the limit.

## Raise the budget

1. On the run page, select **Raise budget**.
2. The dialog is titled **Raise budget** (or **Raise stage cap** when a stage cap was the limit). It
   shows the current cap. Enter a **New budget cap (USD)**, or a **New stage cap (USD)**, that's **higher**.
3. Select **Raise and continue**.

For a run that is paused for budget, the run **continues straight away**: you don't need to press
**Resume**. Raising a stage cap only changes that stage, for this run only. The blueprint isn't touched.

If the new amount isn't higher, you're told: _The new budget cap ($…) must be higher than the current cap
($…)_.

You can also raise the budget on a run that is still running, waiting for you, or failed. There the
button reads **Raise budget**, and it only widens the cap. A **Completed** or **Cancelled** run can't be
changed.

## When a stage's quality control runs out of money

If a stage's judge would go over its quality control cap, the stage doesn't pause: it **fails** with
_qc_budget_exhausted_. Raise the cap in the blueprint and rerun the stage.

## What things cost

See [Costs](../reference/costs.md) for what is paid and what is free. A few habits keep spending
predictable:

- Start with a [dry run](./dry-runs.md).
- Keep the first real run's cap small, and raise it only when you need to.
- Try one stage at a time from the [canvas](./canvas-runs.md).
- Put [human approval](../blueprints/iterate-conditions-approval.md#human-approval) in front of expensive
  stages such as video.
