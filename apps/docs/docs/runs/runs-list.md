---
title: Runs list
description: Find, filter and manage every run, across all channels or within one channel.
---

Select **Runs** in the rail to see your runs. A channel's **Runs** tab shows the same page for just
that channel.

At the top, **Needs you** lists runs that failed or are waiting for a review, an input or more budget,
each with the one action that answers it: **Fix with assistant** and **Open** for a failure,
**Review**, **Provide input** or **Open editor** for a waiting stage, **Raise budget** for a budget
pause. **Running** lists runs still going, with a segment per stage and the stage they are on, plus
**Pause** and **Stop**. Below them, **All runs** lists every run, newest first.

## Filters

At the top:

- **All**, **Running**, **Failed**, **Done**, **Stopped**, and **More states** for the rest: pick one
  [status](../reference/run-statuses.md).
- **All channels**: pick one channel (not shown inside a channel's tab).
- **All blueprints**: pick one blueprint.
- **Show test runs**: include [dry runs](./dry-runs.md) and the temporary runs from the
  [canvas](./canvas-runs.md). They're hidden by default and marked with a **dry run** or **draft**
  badge.

If nothing matches, the list says **No runs match these filters.** With no runs at all, it says
**No runs yet.**

## The list

Each row in **All runs** shows the blueprint and the run's short id (the first 8 characters of its
id), its channel and when it started, its [status](../reference/run-statuses.md), how long it has
run or took, and what it has spent.

Select a row to open its [run page](./run-page.md).

## Row actions

On the right of a row, buttons appear when they apply to that run:

- **Pause run** for a running run;
- **Continue run** for a paused or failed run where that's possible;
- **Stop run**, with a confirmation, for a run that is running or paused.

See [Pause, resume and cancel](./pause-resume-cancel.md).

## Paging

The list shows 20 runs at a time, with the range shown under it, and **Previous** and **Next** buttons.
