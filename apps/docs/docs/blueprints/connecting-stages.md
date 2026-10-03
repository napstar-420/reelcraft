---
title: Connecting stages
description: Feed a stage with the previous stage's output, saved memory, run inputs, assets, characters or fixed values.
---

Each stage needs inputs: a script to read aloud, images to put in a video, a topic to write about.
You connect them in the inspector's **Data (slots, context)** section.

## Slots and context

- **Slots** are the inputs a stage type asks for. For example, **Generate Speech** has a `text`
  slot, and **Concatenate Video** has `clips`, `audio` and `subtitles` slots. Each slot shows:
  - whether it's **required** or **optional**;
  - whether it takes `one` value or `many`.

  A required slot that isn't connected makes the blueprint not runnable.
- **Context** is extra values you add yourself, to use in the prompt. Select **+ add context**, give
  it a key such as `topic`, and connect it. In the prompt, write `{{ topic }}` where the value should
  go. See [Prompts](./prompts.md).

Slot values can be used in the prompt too, by the slot's name.

## Where a value can come from

Every slot and context entry has a picker for where its value comes from:

| Source     | What it gives                                                                  | Extra choice                       |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| `prev`     | The output of the stage just before this one                                   | An optional path                   |
| `memory`   | A value an earlier stage saved under a memory key                              | The key, and an optional path      |
| `input`    | A value or file the person starting the run provided                           | The input, and an optional path    |
| `asset`    | One of the channel's [assets](../channels/assets.md)                           | The asset                          |
| `role`     | The blueprint's [character](../channels/characters.md) and its reference images | The role                          |
| `const`    | A fixed value you type in                                                      | The value and its type             |
| `item`     | The current item, on a stage that [iterates](./iterate-conditions-approval.md#iterate) | An optional path            |
| `prevItem` | This stage's output for the previous item, on a stage that iterates            | An optional path                   |

`prev` isn't offered on the first stage, because there's nothing before it. `item` and `prevItem`
only appear on a stage that iterates.

### Paths

When the value is `data` (a JSON object), a **path** picks one field out of it. For example, if the
previous stage makes `{ "title": "…", "script": "…" }`, a `prev` binding with the path `script` gives
only the script. Separate nested fields with dots, such as `scene.narration`. The path box suggests
the fields it knows about.

On a stage that iterates and makes video, a `prevItem` binding with the path `lastFrame` (or
`firstFrame`) gives a still image of the previous item's video. Bind it to the `startFrame` slot of
[Generate Video](../stage-types/generate-video.md) so each clip starts where the last one ended. For
the first item there is no previous clip, so the slot must be optional.

For an input that takes `many` files, you can also give a position, starting at 0, to pick one file.

### Images and other files in a prompt

On a **Generate Text** stage, files bound under **Context** can be sent to the model so it can see
them, for example to describe an image. Tick **Attach file** next to the context entry. In the
prompt, mention the file by its context key, such as "the image named `photo`". Don't use
`{{ photo }}`: that inserts the file's details as text, not the file itself.

Without **Attach file**, the model only gets the file's details, such as its id and kind. That's
what you want when a text stage writes a [timeline](../video/timelines.md) that refers to the
files.

A [character role](../channels/characters.md) bound under Context on a text stage must be attached.

## Memory

`prev` only reaches back one stage. To use an output further down the line, save it to the run's
**memory**, then read it from any later stage.

1. In the stage that makes the value, open **Output & memory writes** → **Memory writes**.
2. Select **+ Add write**.
3. Enter a **memory key**, such as `script`.
4. Enter a **path** into the output, or `$` to save the whole output. Images, video and audio can
   only be saved whole.
5. In a later stage, bind a slot or context entry to `memory` and pick the key.

The canvas draws a dashed purple line from each stage that writes a key to each stage that reads it,
labelled with the key.

Each memory key can only be written by one stage. If two stages write the same key, the line turns
red and the blueprint shows **memory key "…" is written by multiple stages**.

On a stage that iterates, each item writes its own value. A later stage that reads the key gets them
all as a list, in item order.

## Rules worth knowing

Reelcraft checks connections as you build. The common messages:

- **required slot "…" is unbound**: connect the slot.
- **incompatible source**: the value is the wrong kind for the slot, for example text into an image
  slot.
- **`{from: "prev"}` is invalid on the first stage in a blueprint**: the first stage has no previous
  stage. Use an input, an asset, a fixed value or memory instead.
- **cardinality:'one' slot bound to an iterating producer**: the previous stage made one output per
  item, but this slot takes one value. Iterate this stage too and tick **align with item**, or read
  the outputs through memory.
- **binds `{from:'prev'}` to "…", which is conditionally enabled**: the previous stage might be
  skipped. Give this stage the same **Enabled when** condition.

See [Validation messages](../reference/validation-messages.md) for the full list.
