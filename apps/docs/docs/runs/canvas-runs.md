---
title: Canvas runs
description: Run, continue and rebuild stages on the canvas with the same controls as the run page.
---

The blueprint canvas and [run page](./run-page.md) share one execution model, run history, eligibility
rules and control components. Development on the canvas and production on the run page use the same
runs. Moving between them keeps your selected run and its progress.

![Canvas toolbar, stage cards and Run tab showing six saved Motion Planning items](/img/usage/unified-canvas-runs.png)

## The first run

With no runs yet, select **Run blueprint**, provide inputs and start a run. **Run up to** is an explicit
initial scope: it includes the selected stage and its prerequisites. All stages are created Pending;
work outside that scope stays Pending. See [Starting a run](./starting-a-run.md).

## Shared run controls

Once a run is selected, the canvas toolbar and **Run** tab offer the same controls as the run page:

- **Run blueprint** executes unfinished, failed or stale required stages, retaining completed work.
- **Re-run blueprint** explicitly regenerates everything after a rebuild/cost confirmation.
- **Pause**, **Resume**, **Cancel run** and **Continue run** preserve the same run and saved scope.
- **Concurrent branches** sets the maximum active stage executions. The blueprint default is **2**;
  an inactive run can override it without changing artifacts. Iteration item concurrency and provider
  request limits are separate controls.

Independent ready branches fill available slots. A finished stage releases its slot immediately;
there is no full-wave barrier. Failures and human waits block their descendants while other ready
branches continue. A stage-only scope ends **Idle** when required blueprint work remains.

## Stage controls

The canvas cards and **Run** tab use the same stage controls:

- **Run stage** runs only an eligible selected stage. Missing prerequisites or inputs are shown beside
  a blocked stage; prerequisites are never launched implicitly.
- **Continue stage** preserves passed items. For **6/14 completed**, only eight items remain.
- **Re-run stage** explicitly regenerates the stage, including completed items. Its affected
  descendants become stale, but do not execute.
- **More execution actions** contains **Run through stage** and **Rebuild descendants**, each with an
  explicit scope. In compact cards, **Re-run stage** may also appear here.

Stage execution controls are hidden while the run is Running, Pausing or Cancelling. Progress,
output previews and attempt history remain visible. Cancel is a run action; a cancelled run can
continue later. See [Continue and re-run work](./retries.md).

## Definitions and existing outputs

Autosaved execution edits mark affected outputs **Stale** in the workspace, including descendants.
Independent branches remain valid. Label changes do not stale outputs; check/QC-only edits show
**Validation outdated**. Reverting an edit restores freshness when definitions and dependencies match.

These indicators preserve historical artifacts. Execution uses a pinned snapshot. If you apply edits,
review a plan choosing existing outputs or rebuilding affected work; ordinary **Run stage** stays
stage-only. **Check existing output** applies check/QC-only edits without generation where supported.

Plans bind the exact action, scope, items, snapshot, concurrency setting and run revision. Duplicate
or outdated confirmations are rejected. Added/removed stages, rewiring, reordered stages, global
input/role/default changes and replaced pinned assets require a new run. Scheduling concurrency alone
does not stale artifacts.

## History and navigation

Use the recent-run selector to return to an earlier run. The selection is stored in the URL, so
refreshing preserves it. Select the short run ID to open its run page; **Open canvas** returns to the
same selected run. **View output**, **Attempts** and approval/input controls retain their usual roles.

## Follow branches and inspect a stage

The **Run** tab shows a dependency overview with branches, joins, status, and saved branch names.
Select a node to focus that stage and see its controls and blocking reason. **Output** or **Attempts**
opens the shared **Details** tab beside the canvas; drag the divider to resize it or select **Expand**.
The same details workspace is available on the run page, with identical execution semantics.
