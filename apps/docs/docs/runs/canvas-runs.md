---
title: Canvas runs
description: Try stages one at a time while you build, without saving a version or starting from scratch.
---

While you build a blueprint, you don't want to rerun everything after each small change. The **Run**
tab beside the canvas lets you run a blueprint, or one stage of it, and see the results next to the
canvas. Each stage card shows the same status, so you can watch a run without leaving the diagram.

## The first run

With no runs yet, the tab says **No runs yet**. Select **Run blueprint**, fill in the inputs and start a
run, as in [Starting a run](./starting-a-run.md).

After that, the tab follows the latest run.
Use the recent-run selector at the top of the tab to return to an earlier run. Your selection stays
in the page URL, so refreshing keeps that run selected.

## What the tab shows

- The run's short id, as a link to its [run page](./run-page.md), with its status and how long it has
  taken, and a bar showing what it has spent against the run's cap.
- **Run all**, **Cancel run**, **Pause** and **Resume**, whichever apply.
- A list of the stages, each with a status dot, its label and buttons. Select a label to open that stage
  in the **Stage** tab.
- **Blueprint output**: the result of the last stage, once it has run.
- **Memory**: the values stages have saved. See
  [Connecting stages](../blueprints/connecting-stages.md#memory).

## Run all

**Run all** continues a completed partial run when its blueprint is unchanged. It keeps the same run ID,
finished outputs, item progress and spending history, and runs the unfinished branches through their joins.

When edits affect completed outputs, review an execution plan before continuing. The plan lists the
stages that will run, completed outputs that will remain, outputs that become stale, and historical
costs for the work. Stages with no previous execution are unpriced. Budget caps still apply.

**Rerun** on the run page and **Run up to** in the run dialog don't reuse anything: they start a fresh run
from the first stage.

## Run only the first stages

Before a blueprint has any run, there is no play button on the stages yet. Select **Run**, then pick a stage
under **Run up to**. Reelcraft runs that stage and its dependencies, skipping unrelated branches. Once the run
finishes, use the play button to continue another branch.

## Run a single stage

Select the play button next to a stage, in the **Run** tab or on its card. For completed and failed runs,
execution stays in the same run. If edits or reruns affect completed work, choose a plan:

- **Use existing upstream outputs** executes the selected stage using the run's stored upstream
  definitions and outputs, even when the draft changed those stages. Independent outputs remain.
- **Apply edits and run through selected stage** rebuilds changed prerequisites and the selected stage.
  Affected outputs beyond this boundary become stale and wait for another action.
- **Apply edits and rebuild affected descendants** also executes every affected descendant, including
  joins and required unfinished dependencies. Unaffected branches retain their outputs.
- **Check existing output without regenerating** appears for validation-only edits on
  non-iterating stages with a stored output. It applies updated checks/QC to the stored output; QC can incur judge costs.
  A failed check stops execution rather than silently generating another output. Descendant outputs
  are conservatively invalidated and deferred when revalidation is requested.
- **Cancel** starts nothing.

A confirmation is bound to the exact snapshot, choice, scope, configuration, and run revision.
Concurrent changes and duplicate requests require a fresh preview. A consumer with changed bindings,
iteration or output contracts cannot silently reuse old upstream outputs. Graph additions, deletions,
rewiring, reordered stages, global input/role/default changes, and replaced pinned assets require a
new run; the existing run and its output history remain available.

While a stage is running, its button on the card turns into a stop button, labelled **Cancel run**. There's no way
to stop just one stage: it cancels the whole run, and Reelcraft asks first: **Cancel this run? This
stops the whole run, not just one stage. It can't be undone.**

## Unsaved changes

Autosaved execution edits mark affected outputs **Stale** in the workspace, including descendants.
Independent branches remain valid. Label changes do not stale outputs; check/QC-only edits show
**Validation outdated**. Output previews explain their freshness. Reverting an edit restores freshness
when definitions and dependencies match again.

These workspace indicators do not erase artifacts or rewrite historical run validity. An execution
uses an immutable snapshot; edits made while it runs affect workspace freshness after it finishes.
Choosing existing outputs records the retained artifact IDs and snapshot lineage in the stage log.
The resulting output remains stale relative to a draft whose upstream definitions still differ.

Canvas execution creates a temporary snapshot without adding a saved version. Only definitions
applied by the confirmed plan replace the run snapshot; other draft edits remain in the workspace.

Select **Save** when you're happy. [Versions](../blueprints/versions.md) explains the difference.

The blueprint must be **Runnable** for any of these to start.

## The stage buttons

- **View output** (the eye): the stage's current output.
- **Attempts** (the clock): every attempt, with its log.
- **Review** (on the card) or **Review output** (in the tab): appears on the stage waiting for your approval. See
  [When a run needs you](./when-a-run-needs-you.md).
