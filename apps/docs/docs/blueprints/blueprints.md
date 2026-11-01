---
title: Blueprints
description: Create a blueprint, find your way around its editor, and archive or delete blueprints you no longer need.
---

A **blueprint** is the recipe for a video. It's a dependency graph of **stages**. Each stage
does one job, such as writing a script, making images, recording a voice-over or putting the video
together. Each stage can use the outputs of the stages before it.

You build a blueprint once, then [run](../runs/starting-a-run.md) it as often as you like, with
different inputs each time.

## Create a blueprint

The quickest way is to describe the video to the assistant:

1. On **Home**, type what you want in **What are we making today?**, for example "A 45-second
   history short from a topic: script, voice-over, one image per scene, captions".
2. Pick the channel, and leave **New blueprint** selected.
3. Select **Send**. Reelcraft creates the blueprint, opens it and hands your message to its
   assistant, which proposes the stages. See [The assistant](./assistant.md).

To start from an empty blueprint instead:

1. Open **Blueprints** in the rail on the left (or a channel's **Blueprints** tab).
2. Select **Blank blueprint**.
3. Enter a **Blueprint name** and select **Create blank blueprint**. Or select **Import package** to
   add a blueprint someone sent you. See [Sharing blueprints](./sharing.md).

Blueprint names must be unique within a channel. If the name is taken, you'll see **A blueprint
named "…" already exists in this channel** and an **Open it** button that takes you to the existing
one.

## Find a blueprint

**Blueprints** in the rail lists every blueprint in every channel. Each card shows the channel, the
latest saved version, the number of stages, its phases (such as **Script › Voice › Visuals**),
whether a run is going or needs you, and **Edit** and **Run**. Filter by name, description or tag, or
pick a channel. You can also press **Cmd K** (Ctrl K) anywhere and type part of its name.

## The blueprint editor

The editor has a bar across the top, the blueprint in the middle and the assistant on the right.

**The top bar** shows:

- the blueprint's channel, name and latest saved version, such as `v1.2`;
- whether you have **Unsaved changes** or **All changes saved**;
- whether the blueprint is **Ready to run** or **Not runnable yet**, with how many problems it has;
- **Stages** and **Graph**, to switch views;
- **History**, **Discard**, **Save** and **Test run**.

See [Versions](./versions.md) for saving, and [Test runs on the canvas](../runs/canvas-runs.md) for
**Test run**.

### Stages view

The default view reads like a document.

**On the left**, the outline lists:

- **Inputs, voices and budget**: the run cap, inputs, the character role and defaults. See
  [Blueprint settings](./settings.md).
- **Test runs**: the latest test run of this blueprint. See [Test runs](../runs/canvas-runs.md).
- every stage, numbered and grouped by phase, with its last test-run state (a dot), **edited** when
  it has unsaved changes, or how many problems it has. Type in **Find a stage** to filter.

**In the middle**, the selected stage opens with:

- its number, phase and type, and its name;
- a summary in plain words: what it does, what it runs after, whether it repeats for each item,
  what every result must pass, and whether it waits for your approval;
- **Setup**: **Runs after**, **Stage turned on**, and the stage's settings. See [Stages](./stages.md);
- **Last test run**, once a test run has reached it: its output, attempts, inputs and memory.

**On the right**, the assistant stays open while you work. Hide it with the panel button in its
header; it then waits as an **Assistant** button in the bottom right corner.

### Graph view

**Graph** shows the blueprint from left to right as cards joined by their dependencies:

- The **Start** card, **Blueprint inputs**, lists the inputs a run asks for, the role and the run cap.
- One card for each stage. Connections show dependencies; independent branches can run together.

Drag the canvas to move around. Scroll to move, and pinch or hold Ctrl (or ⌘) and scroll to zoom.

**Tidy up** arranges nodes in dependency layers. **Fit** shows the complete graph; **Focus** centers
the selected stage. Drag cards freely to place them wherever you prefer. Position changes never change
dependencies or make artifacts stale. Layout and branch names are shared with the blueprint and
retained in drafts, saved versions, and exported packages. **Undo** and **Redo** restore position,
Tidy up, connection, branch-name, and enable/disable edits.

Selecting a card shows the stage's summary at the bottom, with **Edit stage** to open it in Stages
view.

![Editable DAG canvas and dependency overview](/img/usage/dag-canvas-inspection.jpg)

### Add a stage

Select **Add stage** at the bottom of the outline (or at the top left of the graph), or press **A**,
and pick a stage type from the list, such as **Generate Text**. Type to search. The right side says
what the highlighted type does. **Describe it instead** hands the stage to the assistant. In Stages
view a new stage goes after the selected one. See [Stage types](../stage-types/index.md) for what each
one does.

In Graph view, to put a stage in the middle of the blueprint, hover between two cards and select the **+** that
appears, then pick a type. The list says where it will go, for example **Inserted between Write script
and Plan shots**.

A stage added at the end goes after the last card. Its label is the stage type's name, such as
**Generate Text**, or **Generate Text 2** if that label is taken. Its key is `stage-1`, `stage-2`, and
so on.

### Open a stage

Select a stage in the outline, or a card in Graph view. See [Stages](./stages.md).

### Read the cards

In Graph view, each card shows:

- the stage's label and type, with its key above it;
- its model/provider, with full details on hover or keyboard focus;
- the inputs it takes and the output it makes, and the memory keys it writes;
- what it does beyond the basics: **Each item**, **Approval**, **QC**, its checks, and **If …** when it
  only runs on a condition;
- its problems, if it has any: **✗** with the number of errors, **⚠** with the number of warnings;
- once there's a run, its status, duration, cost, item progress and eligible execution action;
- the specific failure or blocking reason, including the responsible upstream stage;
- **Output** and **Attempts** shortcuts into the same details workspace.

Execution connections join prerequisite stages to their consumers, including branches and joins. Dashed purple lines show **memory**: a value one stage
saves and a later stage reads, labelled with its key. A red dashed line means two stages write the
same memory key, which you'll need to fix. Memory links are hidden by default; turn **Memory links** on to inspect them. See
[Connecting stages](./connecting-stages.md#memory).

### Connect stages and name branches

Select **Create branch** on B to add a new stage after B without changing an existing B → C branch.
Drag from a stage's right output handle to another stage's left input handle to add an execution dependency.
Self-connections and cycles are rejected. The inspector also provides keyboard-accessible **Add dependency**
and **Disconnect…** selectors.

Select a connection and choose **Disconnect / edit binding**, or use Delete on a selected connection.
An input, context, iteration, check, or memory binding still creates a dependency: remove or replace that
binding in the inspector before disconnecting it. Existing positional references are preserved explicitly
when connection editing changes graph order.

Enter a label in **Name branch…** above its first stage. Branch names also appear in the **Test runs** dependency overview. Renaming a branch changes presentation only.

### Temporarily disable a stage

Turn off **Stage turned on** in the stage's **Setup**. Blueprint execution skips the stage. Every descendant shows
a validation error naming the disabled ancestor; whole-blueprint execution is blocked until those errors
are resolved. Independent branches remain eligible for stage-only execution.

The disabled stage can still **Run**, **Continue**, or **Re-run** explicitly when its prerequisites and
inputs are ready. Its outputs remain stored and inspectable, but direct output references and memory
cannot consume them until it is enabled again. Re-enabling restores compatible output availability;
it does not run descendants or clear unrelated stale reasons. Re-running still stales affected descendants.
Changes to an existing run use an explicit, revision-bound execution plan; active runs retain their snapshot.

### Delete a stage

Select the bin next to the stage's name, or hover over its card in Graph view and select the bin. There's no
confirmation, and nothing is saved until you save. A message appears with **Undo**. You can also select
**Discard** to go back to your last save, which discards all your unsaved changes, not only the delete.

## Edit a blueprint's details

On **Blueprints** (or a channel's Blueprints tab), open the **⋯** menu on the blueprint's card and select **Edit details**.
You can change its **Name**, **Description** and **Tags (comma-separated)**. They're shown on the
card. Changing the name doesn't change any version.

Select **Edit** on a card to open the blueprint, or **Run** to start a run of its latest saved
version.

## Archive a blueprint

Archiving hides a blueprint from the blueprint lists (turn on **Show archived** to see it). Nothing else changes: its versions and runs stay
as they are, and you can still open it.

- To archive one, open **⋯** on its card and select **Archive**.
- To see archived blueprints, turn on **Show archived** at the top of the list.
  Archived blueprints show an **Archived** badge.
- To bring one back, select **Unarchive** in the same menu.

## Delete a blueprint

Deleting a blueprint permanently removes it, every saved version, and every run made from it,
including their outputs. It can't be undone.

1. Open **⋯** on the blueprint's card and select **Delete**.
2. Type the blueprint's name exactly as shown.
3. Select **Delete permanently**. (**Archive instead** hides it without deleting anything.)

You can't delete a blueprint while any of its runs is still going, including paused runs and runs
waiting for you. Finish or cancel them first.

The files its runs made are removed from storage in the background, by default about 30 days later.
