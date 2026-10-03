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
3. Enter a **Blueprint name** and select **Create**.

The blueprint's canvas opens, ready for its first stage.

Blueprint names must be unique within a channel. If the name is taken, you'll see **A blueprint
named "…" already exists in this channel** and an **Open it** button that takes you to the existing
one.

## The canvas

The canvas is where you build the blueprint. From top to bottom:

- **The header** shows:
  - the latest saved version, such as `v1.2`;
  - the **Versions** menu;
  - whether you have **Unsaved changes**;
  - whether the blueprint is **Runnable** or **Not runnable yet**.

  See [Versions](./versions.md).
- **Blueprint settings**: the run cap, inputs, the character role and defaults. See
  [Blueprint settings](./settings.md).
- **Stages**:
  - a list of the stages with a **Delete** button on each;
  - a diagram of the stages;
  - the menu to add a stage;
  - the **run panel**, for trying stages out (see [Canvas runs](../runs/canvas-runs.md)).
- **Save & run**: save a version, start a run or a dry run.

### Add a stage

1. Under the stages, open the stage type menu and pick a type, such as **Generate Text**. See
   [Stage types](../stage-types/index.md) for what each one does.
2. Select **+ Add stage**.

The new stage goes at the end. Its label is the stage type's name, such as **Generate Text**, or
**Generate Text 2** if that label is taken. Its key is `stage-1`, `stage-2`, and so on.

### Open a stage

Select a stage's card in the diagram. Its **inspector** opens on the right, with every setting for
that stage. See [Stages](./stages.md).

### Read the diagram

Each card shows:

- the stage's label and key;
- the start of its instructions;
- the inputs it takes and the output it makes;
- its problems, if it has any: **✗** with the number of errors, **⚠** with the number of warnings.

Solid lines join each stage to the next one. Dashed purple lines show **memory**: a value one stage
saves and a later stage reads, labelled with its key. A red dashed line means two stages write the
same memory key, which you'll need to fix. See
[Connecting stages](./connecting-stages.md#memory).

### Reorder stages

Drag a card left or right in the diagram and drop it where it should go. The stages run in the order
shown, from left to right.

### Delete a stage

Select **Delete** next to the stage in the list. There's no confirmation, but nothing is saved until
you save. If you delete a stage by mistake, select **Discard changes** to go back to your last save.
That discards all your unsaved changes, not only the delete.

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
