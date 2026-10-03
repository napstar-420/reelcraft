---
title: Runs list
description: Find, filter and manage every run, across all channels or within one channel.
---

Select **Runs** in the sidebar to see every run, newest first. A channel's **Runs** tab shows the same
list for just that channel.

## Filters

At the top:

- **All channels**: pick one channel (not shown inside a channel's tab).
- **All blueprints**: pick one blueprint.
- **All states**: pick one [status](../reference/run-statuses.md), such as **Failed** or **Paused
  Approval**.
- **Show test runs**: include [dry runs](./dry-runs.md) and the temporary runs from the
  [canvas](./canvas-runs.md). They're hidden by default and marked with a **dry run** or **draft**
  badge.

If nothing matches, the list says **No runs match these filters.** With no runs at all, it says
**No runs yet.**

## The list

Each row shows:

| Column             | What it is                                             |
| ------------------ | ------------------------------------------------------ |
| **Run**            | The first 8 characters of the run's id                 |
| **Channel**        | Its channel                                            |
| **Blueprint**      | The blueprint and version, such as `Launch video v1.3` |
| **State**          | Its [status](../reference/run-statuses.md)             |
| **Spent / Budget** | What it has spent, out of its budget cap               |
| **Started**        | When it began                                          |
| **Duration**       | How long it has run, or took                           |

Select a row to open its [run page](./run-page.md).

## Row actions

On the right of a row, buttons appear when they apply to that run:

- **Pause run** for a running run;
- **Resume run** for a paused or failed run where that's possible;
- **Cancel run**, with a confirmation.

See [Pause, resume and cancel](./pause-resume-cancel.md).

## Paging

The list shows 20 runs at a time, with the range shown under it, and **Previous** and **Next** buttons.
