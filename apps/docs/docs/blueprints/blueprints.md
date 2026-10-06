---
title: Blueprints
description: Create a blueprint, find your way around its canvas, and archive or delete blueprints you no longer need.
---

A **blueprint** is the recipe for a video. It's a list of **stages** that run in order. Each stage
does one job, such as writing a script, making images, recording a voice-over or putting the video
together. Each stage can use the outputs of the stages before it.

You build a blueprint once, then [run](../runs/starting-a-run.md) it as often as you like, with
different inputs each time.

## Create a blueprint

1. Open a channel and select the **Blueprints** tab.
2. Select **Create custom blueprint**.
3. Enter a **Blueprint name** and select **Create blank blueprint**.

The blueprint's canvas opens, ready for its first stage.

Blueprint names must be unique within a channel. If the name is taken, you'll see **A blueprint
named "…" already exists in this channel** and an **Open it** button that takes you to the existing
one.

## The canvas

The canvas is where you build the blueprint. It fills the page, with a bar across the top and one
panel on the right.

**The top bar** shows:

- the blueprint's name and the latest saved version, such as `v1.2`;
- whether you have **Unsaved changes** or **All changes saved**;
- whether the blueprint is **Runnable** or **Not runnable yet**, with how many problems it has;
- **Versions**, **Discard**, **Save** and **Run**.

See [Versions](./versions.md) for saving, and [Starting a run](../runs/starting-a-run.md) for **Run**.

**The canvas itself** shows the blueprint from left to right:

- The **Start** card, **Blueprint inputs**, lists the inputs a run asks for, the role and the run cap.
  Select it to open the **Blueprint** tab.
- One card for each stage, in the order they run.
- An **Add stage** card at the end.

Drag the canvas to move around. Scroll to move, and pinch or hold Ctrl (or ⌘) and scroll to zoom.

**The strip along the bottom** has a pill for every stage (select one to jump to it), a **problems**
button when there are any, and the zoom buttons. The last one fits every stage on screen.

**The panel on the right** has three tabs:

- **Stage**: the settings of the selected stage. See [Stages](./stages.md).
- **Run**: the latest run, for trying stages out. See [Canvas runs](../runs/canvas-runs.md).
- **Blueprint**: the run cap, inputs, the character role and defaults. See
  [Blueprint settings](./settings.md).

Select **✕** to hide the panel, and **Panel** to bring it back. The expand button next to it makes the
panel wider.

![The blueprint canvas: the stage cards, the stage strip and the Stage tab](/img/usage/blueprint-canvas.png)

### Add a stage

Select **Add stage** at the top left of the canvas, or press **A**, and pick a stage type from the list,
such as **Generate Text**. Type to search. See [Stage types](../stage-types/index.md) for what each one
does.

To put a stage in the middle of the blueprint, hover between two cards and select the **+** that
appears, then pick a type. The list says where it will go, for example **Inserted between Write script
and Plan shots**.

A stage added at the end goes after the last card. Its label is the stage type's name, such as
**Generate Text**, or **Generate Text 2** if that label is taken. Its key is `stage-1`, `stage-2`, and
so on.

### Open a stage

Select a stage's card. Its settings open in the **Stage** tab. See [Stages](./stages.md).

### Read the cards

Each card shows:

- the stage's label and type, with its key above it;
- the start of its instructions;
- the inputs it takes and the output it makes, and the memory keys it writes;
- what it does beyond the basics: **Each item**, **Approval**, **QC**, its checks, and **If …** when it
  only runs on a condition;
- its problems, if it has any: **✗** with the number of errors, **⚠** with the number of warnings;
- once there's a run, the stage's status, what it cost, and a play button to run just that stage.

Solid lines join each stage to the next one. Dashed purple lines show **memory**: a value one stage
saves and a later stage reads, labelled with its key. A red dashed line means two stages write the
same memory key, which you'll need to fix. Turn **Memory links** off to hide them. See
[Connecting stages](./connecting-stages.md#memory).

### Reorder stages

Drag a card left or right and drop it where it should go. Or hover over a card and select **Move
earlier** or **Move later**. The stages run in the order shown, from left to right.

### Delete a stage

Hover over the card and select the bin, or select the bin at the top of the **Stage** tab. There's no
confirmation, and nothing is saved until you save. A message appears with **Undo**. You can also select
**Discard** to go back to your last save, which discards all your unsaved changes, not only the delete.

## Edit a blueprint's details

On the Blueprints tab, open the **⋯** menu on the blueprint's card and select **Edit details**.
You can change its **Name**, **Description** and **Tags (comma-separated)**. They're shown on the
card. Changing the name doesn't change any version.

Each card also shows the poster from the blueprint's latest finished video, if there is one, and how
many runs it has had. Select **Open →** to open its canvas.

## Archive a blueprint

Archiving hides a blueprint from the Blueprints tab. Nothing else changes: its versions and runs stay
as they are, and you can still open it.

- To archive one, open **⋯** on its card and select **Archive**.
- To see archived blueprints, turn on **Show archived** at the top of the list. It shows how many
  there are. Archived blueprints show an **Archived** badge.
- To bring one back, select **Unarchive** in the same menu.

## Delete a blueprint

Deleting a blueprint permanently removes it, every saved version, and every run made from it,
including their outputs. It can't be undone.

1. Open **⋯** on the blueprint's card and select **Delete**.
2. Type the blueprint's name exactly as shown.
3. Select **Delete permanently**.

You can't delete a blueprint while any of its runs is still going, including paused runs and runs
waiting for you. Finish or cancel them first.

The files its runs made are removed from storage in the background, by default about 30 days later.
