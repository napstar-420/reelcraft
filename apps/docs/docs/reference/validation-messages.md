---
title: Validation messages
description: The errors and warnings a blueprint can show, what they mean and how to fix them.
---

Reelcraft checks a blueprint as you edit it. Problems show on the stage they belong to, as **✗** for an
**error** and **⚠** for a **warning**, and problems with the blueprint as a whole show above **Blueprint
settings**. See [Versions](../blueprints/versions.md#runnable-or-not).

- An **error** makes the blueprint **Not runnable yet**. Fix it before you can run.
- A **warning** is advice. The blueprint still runs.

## Motion graphics

- **Generate Motion Graphic produces data (the code and its settings)**: set the output to **Data**, with the
  motion graphic schema. See [Generate Motion Graphic](../stage-types/generate-motion-graphic.md).
- **Add the motion_code check so code that breaks the rules is sent back to the model to fix** (warning): add
  the `motion_code` [built-in check](./built-in-checks.md) and set **Check attempts** to 2 or 3.
- **Render Motion Graphic produces a video**: set the output to **Video**. See
  [Render Motion Graphic](../stage-types/render-motion-graphic.md).

## Sound effects and music

- **describe the sound you want in the stage instructions** / **describe the music you want in the stage
  instructions**: [Generate Sound Effect](../stage-types/generate-sound-effect.md) and
  [Generate Music](../stage-types/generate-music.md) work from a description. Write it in **Instructions**.
- **Length must be 0.5 to 22 seconds** (sound effect) or **3 to 600 seconds** (music): set **durationSec** in
  range.
- **"…" can't make sound effects / music**: the pinned model is for something else. Choose a sound effect or
  music model.

## The blueprint

| Message                                                       | What to do                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| a blueprint must declare at least one stage                   | Add a stage                                                                                            |
| duplicate stage key "…"                                       | Two stages have the same key. Delete one and add it again                                              |
| A blueprint may declare at most one Character role            | Remove all but one role in the **Blueprint** tab → **Role**                                            |
| role "…" is declared but never bound by any stage _(warning)_ | Bind a stage's slot to the role, or remove the role                                                    |
| memory key "…" is written by multiple stages _(warning)_      | Give each stage its own memory key. See [Connecting stages](../blueprints/connecting-stages.md#memory) |

## Parallel stages

| Message                                                                                                 | What to do                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| runs after unknown stage "…"                                                                            | **Runs after** names a stage that doesn't exist. Pick another or switch to **Previous stage**           |
| runs after itself — remove it from dependsOn                                                            | Untick the stage itself in **Runs after**                                                               |
| runs after "…", which comes later in the graph — move this stage after "…"                              | A stage can only wait for an earlier stage. Move this stage after it                                    |
| reads the output of unknown stage "…"                                                                   | The stage chosen under **Output of stage…** is gone. Pick another                                       |
| reads the output of "…", which comes later in the graph — move this stage after "…"                     | Move this stage after the one it reads                                                                  |
| `{from:'stage'} cannot read this stage's own output — use {from:'prevItem'} for the previous item`      | To read the previous item of the same stage, use **prevItem**                                           |
| memory key "…" is written by "…" and "…", which can run at the same time — make one run after the other | Set **Runs after** on one of them to the other. See [Parallel stages](../blueprints/parallel-stages.md) |
| onReject target "…" is not upstream of this stage …                                                     | Pick this stage or a stage it waits for under **Retry stage**                                           |

## Characters and roles

| Message                                                                                   | What to do                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| role "…" must select a channel Character                                                  | Choose a character in the role                                       |
| role "…" uses a Character that was deleted; choose another one                            | Pick another character                                               |
| Character "…" has no usable references                                                    | Add a reference image to the character, so it is **Ready**           |
| role "…" must select at least one reference image                                         | Tick at least one reference image                                    |
| a Character role may bind only to a cardinality:'many' media.image reference slot         | Use the role only on an image or video stage's `references` slot     |
| a Character role in Context must be attached as a file (tick Attach file) on a text stage | Tick **Attach file** on that context entry, on a Generate Text stage |

See [Characters](../channels/characters.md).

## Stages and models

| Message                                                                                | What to do                                                                        |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| unknown capability "…"                                                                 | The stage type isn't available. Choose another                                    |
| capability "…" does not allow output kind "…"                                          | Choose an output the stage type supports. See [Outputs](../blueprints/outputs.md) |
| OpenRouter model "…" does not support structured output                                | Pick another model for a `data` output                                            |
| … model "…" is not available                                                           | Pick another model, or fix the provider's setup in **Settings**                   |
| reasoning effort "…" is not supported by …                                             | Choose an **Effort** the model supports                                           |
| … model discovery failed: …                                                            | The provider couldn't be reached. Check its key and your connection               |
| Model "…" can't read … inputs — pick a model that supports them or remove this binding | Use a model that accepts that kind of file, or untick **Attach file**             |
| attaches N files but model "…" reads at most M per request                             | Attach fewer files                                                                |
| "…" is text or data, not a file, so it can't be attached                               | Only files can be attached. Untick **Attach file**                                |
| browser automation requires data output                                                | Set the stage's output to `data`                                                  |
| browser startUrl must use HTTP or HTTPS                                                | Fix the address in **startUrl**                                                   |
| human.timeline_edit requires a timeline, clips, or images slot                         | Connect at least one of them                                                      |
| a "data" output schema with no properties provides little type safety _(warning)_      | Add properties to the schema                                                      |

## Connections

| Message                                                                                            | What to do                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| required slot "…" is unbound                                                                       | Connect the slot                                                                                                                                                  |
| incompatible source: …                                                                             | The connected value is the wrong kind, for example a field of a `data` output where `text` is needed. Choose another source, such as a stage with a `text` output |
| cardinality:'one' slot bound to an iterating producer                                              | See [Connecting stages](../blueprints/connecting-stages.md#rules-worth-knowing)                                                                                   |
| cardinality:'many' slot bound to a scalar source                                                   | The slot wants a list, and the source is one value                                                                                                                |
| `{from: "prev"}` is invalid on the first stage in a blueprint                                      | The first stage has nothing before it. Use another source                                                                                                         |
| `{from:'prev'}` cannot bind an iterating stage's output — use `{alignWith:'item'}` … or Run Memory | See [Iterate](../blueprints/iterate-conditions-approval.md#align-with-item)                                                                                       |
| binds `{from:'prev'}` to "…", which is conditionally enabled …                                     | Give this stage the same **Enabled when**                                                                                                                         |
| reads memory key "…", written only by conditionally-enabled stage "…" …                            | Give this stage the same **Enabled when**                                                                                                                         |
| template references undeclared slot/context name "…"                                               | Fix the `{{ }}` name in the prompt, or add the context entry                                                                                                      |
| template path "…": …                                                                               | The path doesn't exist in that value. See [Prompts](../blueprints/prompts.md)                                                                                     |
| output instructions reference undeclared slot/context name "…"                                     | As above, in **Output instructions**                                                                                                                              |
| references undeclared input "…"                                                                    | The **Enabled when** input doesn't exist                                                                                                                          |
| `{from:"prevItem"}` bound to a required slot/context/check ref is always an error …                | Make the slot optional, so the first item can go without it                                                                                                       |

## Iterate, approval and conditions

| Message                                                                    | What to do                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iterate.over a many-cardinality media source is not yet supported          | Iterate over a list in `data`, not a set of files                                                                                                                                                                                            |
| iterate.over does not narrow to an array schema                            | **Over** must be a list: a memory key whose value is a list, or the previous stage's whole output when that is a list. **prev** with a path into a field isn't accepted. See [Iterate](../blueprints/iterate-conditions-approval.md#iterate) |
| alignWith:'item' requires … to declare iterate                             | Both stages must iterate                                                                                                                                                                                                                     |
| iterate.over does not align with "…"'s iterate.over …                      | Both stages must iterate over the same list                                                                                                                                                                                                  |
| `{from:"prevItem"} cannot be used while iterate.concurrency is above 1: …` | Items running together can't read the previous item. Set **Concurrency** to 1, or stop using **prevItem**                                                                                                                                    |
| approval.mode "item" requires the stage to declare iterate                 | Add **Iterate**, or use mode `stage`                                                                                                                                                                                                         |
| references unknown stage "…"                                               | **Retry stage** names a stage that doesn't exist                                                                                                                                                                                             |
| onReject target "…" comes after this stage in the graph …                  | Choose this stage or an earlier one                                                                                                                                                                                                          |
| target stage "…" has no instructions template … _(warning)_                | Give that stage a Template so your rejection note has something to change                                                                                                                                                                    |

## Checks and quality control

| Message                                                                                   | What to do                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| unknown builtin check "…"                                                                 | Choose a check from the list                                                      |
| script check does not compile: …                                                          | Fix the script's syntax. See [Checks](../blueprints/checks.md#script-checks)      |
| qc is not allowed on media.video output — human approval replaces it                      | Remove quality control, and use human approval                                    |
| qc is not allowed on human.input — user submissions run checks only                       | Remove quality control                                                            |
| Include transcript only works on an audio (media.audio) output                            | Untick it, or use it on a Generate Speech stage                                   |
| wpm measures speaking pace and needs a Generate Speech (media.audio) output … _(warning)_ | Use `wpm` on a Generate Speech stage only                                         |
| stage declares neither checks nor qc _(warning)_                                          | Consider adding a check                                                           |
| video-modality stage declares neither checks nor approval … _(warning)_                   | Add [human approval](../blueprints/iterate-conditions-approval.md#human-approval) |

## Not checked

Reelcraft doesn't warn you about every mistake. In particular, a stage that calls a model but has no model
and no default isn't flagged until it runs. See [Models](../blueprints/models.md).
