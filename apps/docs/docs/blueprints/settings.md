---
title: Blueprint settings
description: The run cap, the inputs a run asks for, the character role and the blueprint's defaults.
---

**Blueprint settings** sit above the stages on the canvas. They apply to the whole blueprint, and
they're saved with each version like everything else on the canvas.

## Budget

**Run cap (USD)** is the usual spending limit for one run of this blueprint. The run dialog starts
with this amount, and you can change it there for each run. See
[Budget and costs](../runs/budget-and-costs.md).

## Inputs

**Inputs** are what a run asks you for when it starts, such as a topic, a script or a photo. Each
run can use different inputs, so one blueprint makes many different videos.

Select **+ add input** and fill in:

- **Key**: the name stages use to refer to it, such as `topic`. Each input needs its own key.
- **Label**: what the run dialog shows, such as "Video topic".
- **Required**: tick it if a run can't start without it.
- **Accepts**: what kind of value it is:

  | Accepts       | The run dialog shows             | Extra setting                                    |
  | ------------- | -------------------------------- | ------------------------------------------------ |
  | `text`        | A text box                       | —                                                |
  | `data`        | A box for JSON                   | **Schema**: the shape the JSON must have         |
  | `media.image` | A file picker for images         | **Cardinality**: `one` file or `many` files      |
  | `media.video` | A file picker for videos         | **Cardinality**                                  |
  | `media.audio` | A file picker for audio          | **Cardinality**                                  |

Select **Remove input** to delete one.

To use an input in a stage, bind a slot or a piece of context to **input** and pick it. For an
input that takes `many` files, you can pick one file by its position, starting at 0. See
[Connecting stages](./connecting-stages.md).

## Role

A **role** lets the blueprint use one of the channel's [characters](../channels/characters.md),
such as a host who should look the same in every image.

1. Select **+ add role**.
2. Give it a **Key** and a **Label**.
3. Choose the **Character**. The label fills in with its name if it's empty.
4. Tick the **Reference images** to send to the model. At least one stays ticked.

A blueprint can have one role. To use it, bind a stage's slot to **role** and pick the role. Select
**Remove role** to remove it.

## Defaults

The **Defaults** card sets a default model for each kind of work, plus retries, a stage cap and the
video format, for every stage in this blueprint. Blueprint defaults win over the channel's defaults,
and a stage's own settings win over both. See [Defaults](../channels/defaults.md).
