---
title: Parallel stages
description: Run stages that don't depend on each other at the same time, such as music, voice-over and b-roll.
---

By default a blueprint is a line: each stage waits for the one before it. Many videos have steps that
don't need each other, though. The music, the voice-over and the b-roll can all be made while the
script is being reviewed. Tell Reelcraft what each stage waits for, and the stages that wait for
nothing in common run together.

## Runs after

Open a stage and, in **Flow control**, pick **Runs after**. It isn't offered on the first stage.

| Choice                         | The stage starts…                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Previous stage** _(default)_ | when the stage just before it has finished. This is how every blueprint worked before          |
| **When its inputs are ready**  | as soon as the stages it reads from have finished, which may be earlier than the one before it |
| **Specific stages**            | when every stage you tick has finished                                                         |

A stage always waits for the stages it reads from, whatever you pick. If it reads `prev`, it waits
for the previous stage. If it reads a [memory](./connecting-stages.md#memory) key, it waits for the
stages that write that key before it. **Specific stages** adds waits on top of that, for when order
matters but no data moves between two stages.

Stages that wait for the same thing run at the same time. A stage that waits for several joins them:
it starts when the last one has finished.

## An example

```text
Write script ─┬─ Voice-over ──┐
              ├─ B-roll ──────┼─ Assemble
              └─ Music ───────┘
```

1. Add the stages in the order you like, with **Write script** first.
2. On **Voice-over**, **B-roll** and **Music**, leave **Runs after** as **Previous stage** only on the
   first of them. Set the other two to **Specific stages** and tick **Write script**.
3. Set **Assemble** to **Specific stages** and tick all three.

The canvas draws the stages in columns, with stages that run side by side stacked in rows, and joins
them with lines. A blueprint with no **Runs after** settings looks exactly as it did before.

## Reading a stage that isn't the previous one

A slot or context entry can read the output of any earlier stage. In its source picker choose
**Output of stage…**, then pick the stage. This is the same as `prev`, but for a stage further back or
on another branch, and it makes the stage wait for it. See [Connecting stages](./connecting-stages.md#where-a-value-can-come-from).

Reading an output with **Output of stage…** doesn't need memory, so it works without choosing a key.
Use memory when several later stages need the same saved value.

## Memory and parallel stages

Two stages that write the same memory key must not run at the same time, because whichever finished
last would win. If they could, the blueprint shows **memory key "…" is written by "…" and "…", which can
run at the same time — make one run after the other**. Set **Runs after** on one of them to the other.

## What a run does

- Ready stages start up to **Concurrent branches** (blueprint default **2**, with an inactive-run override). A freed stage slot refills immediately. The run page lists **Running now: …**. Item concurrency and provider limits are separate.
- If one of them fails, the others are allowed to finish, then the run is **Failed**. Nothing is thrown away: retry
  only the stage that failed, and the stages that passed stay passed.
- If one of them needs your approval or input, independent runnable branches continue. Its descendants stay blocked, and the run parks after independent work settles. If several stages are waiting for you, answer each; the run
  carries on once the last one is answered. See [When a run needs you](../runs/when-a-run-needs-you.md#several-things-waiting).
- If the budget runs out, the run pauses after the stages that were already running have finished.

Parallel stages share the run's [budget](../runs/budget-and-costs.md), so the cap covers all of them
together. They can also run into a provider's own limits: a provider that handles one request at a
time (some accounts do) makes parallel stages take turns, and then you gain nothing by running them
together.

## Moving and deleting stages

- You can drag stages to reorder them only while the blueprint is a single line. With branches, use
  **Runs after**.
- A stage can't move before a stage it waits for, or after a stage that waits for it.
- Deleting a stage makes the stages that waited for it wait for what it waited for, so the blueprint
  stays connected. **Undo** brings it back as it was. A stage that read the deleted stage with
  **Output of stage…** shows an error, because the output it read is gone.

## Running to a stage

**Run stage** executes only the selected eligible stage. **Run through stage** explicitly includes required unfinished prerequisites. Stages outside the selected scope remain Pending. A reused earlier run doesn't re-run a branch you didn't ask for.

## Changing **Runs after** later

Changing only when a stage starts doesn't change what it makes, so it doesn't make an earlier run's
output out of date. Reusing a finished run still works after you add or change **Runs after**.
