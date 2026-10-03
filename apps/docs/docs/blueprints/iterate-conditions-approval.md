---
title: Iterate, conditions and approval
description: Repeat a stage for every item in a list, run a stage only when an input matches, and pause for your approval.
---

These three extras sit at the bottom of the stage inspector. Each starts as a button: **+ add
condition**, **+ add human approval** and **+ add iterate**. A stage can have any combination.

## Iterate

**Iterate** runs a stage once for each item in a list, one after another. Use it for work that
repeats, such as one image and one video clip per scene of a script.

1. Open the stage and select **+ add iterate**.
2. Under **Over**, choose where the list comes from. It must be a list, for example a `scenes` field
   of a previous stage's `data` output. See [Connecting stages](./connecting-stages.md).
3. Set the **Item alias**, the name of the current item. It starts as `item`.
4. Optionally set **Item retry limit** and **Max items**.

Inside the stage, the current item is available as the alias in the prompt (`{{ item }}`,
`{{ item.narration }}`) and in slots and context, by binding to **item**. To use the same stage's
result for the **previous** item, for example to start a clip from the last frame of the one before,
bind to **prevItem**. See
[Connecting stages](./connecting-stages.md#paths). For the first item there is no previous item.

How it runs:

- Items run **one at a time, in order**. Nothing runs in parallel.
- Each item's output is saved separately. A later stage can read all of them as a list.
- **Item retry limit** is how many times one item tries again after a crash before the stage fails.
  It's separate from the stage's own **Retries**.
- **Max items** limits how many items are used. Empty uses every item, up to a built-in limit of 50.
- If one item fails for good, the stage fails. Items that already succeeded are kept, and
  [resuming](../runs/retries.md) doesn't redo them.

### Align with item

Select **align with item** when this stage and the one before it both iterate over the **same list**
and you want item 3 of this stage to use item 3 of the previous stage's output. Tick it on the
stage's `prev` binding (and on the **Iterate** box), instead of reading all of the previous stage's
outputs at once.

Reelcraft checks that both stages iterate over the same list, and tells you if they don't:
**iterate.over does not align with "…"'s iterate.over**.

A stage that reads an iterating stage's output with a plain `prev` gets an error. Use align with
item, or read the outputs through [memory](./connecting-stages.md#memory).

## Enabled when

**Enabled when** makes a stage run only for some runs, based on one of the run's
[inputs](./settings.md#inputs).

1. Open the stage and select **+ add condition**.
2. Choose the **Input**.
3. Set **equals** to the value, and its type: `string`, `number` or `boolean`.

When a run starts and the input doesn't equal the value, the stage is **skipped**: it doesn't run,
costs nothing, and the run carries on with the next stage. The run page shows it as skipped. See
[Run statuses](../reference/run-statuses.md).

Details:

- The comparison is exact. For a text input, a number or true/false condition also matches the text
  `3` or `true`, ignoring spaces around it.
- If the run didn't provide the input at all, the condition isn't met and the stage is skipped.
- Stages after a skipped stage still run, so they can't depend on its output. If a later stage reads
  the skipped stage's output with `prev`, or from memory, give it the same **Enabled when**. Reelcraft
  reminds you with an error when you forget.

Select **Remove condition** to take it off.

## Human approval

**Human approval** pauses the run after a stage so you can look at its output before anything else
happens. Use it where a bad result is expensive to carry forward, or for video: quality control
isn't available for video outputs, and approval takes its place.

1. Open the stage and select **+ add human approval**.
2. Choose the **Mode**:
   - `stage` pauses once, for the stage's whole output;
   - `item` pauses after **each item** of a stage that iterates.
3. Optionally select **+ add on-reject** and choose a **Retry stage**.

When the stage finishes, the run pauses as **Paused Approval** and its page asks for your review.
Select **Review output** to open it. See [When a run needs you](../runs/when-a-run-needs-you.md).

- **Approve** accepts the output and the run continues.
- **Reject** asks for a confirmation first, showing which stages will be redone and the estimated
  cost of redoing them. Add a **Rejection note** to explain what should change, then **Confirm
  rejection**. The note goes into the next attempt's prompt as feedback.

### Retry stage

By default, rejecting a stage reruns **that stage**. If the real problem is further back, for example
a script you don't like, choose an earlier stage as the **Retry stage**. Rejecting then redoes that
stage and everything after it, including this stage. The Retry stage can only be this stage or an
earlier one, and it should have instructions for your note to be useful.

In `item` mode, rejecting an item redoes that item. If the Retry stage also iterates, only the same
item of it is redone.

### What rejecting costs

You can reject as many times as you like; there's no limit, and rejections never use the stage's
**Retries**. But every rejection redoes the work and spends money again, and the confirmation shows
the estimate first.

Select **Remove human approval** to take approval off.
