---
title: Validation messages
description: The errors and warnings a blueprint can show, what they mean and how to fix them.
---

Reelcraft checks a blueprint as you edit it. Problems show on the stage they belong to, as **✗** for an
**error** and **⚠** for a **warning**, and problems with the blueprint as a whole show above **Blueprint
settings**. See [Versions](../blueprints/versions.md#runnable-or-not).

- An **error** makes the blueprint **Not runnable yet**. Fix it before you can run.
- A **warning** is advice. The blueprint still runs.

## The blueprint

| Message                                                       | What to do                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| a blueprint must declare at least one stage                   | Add a stage                                                                                            |
| duplicate stage key "…"                                       | Two stages have the same key. Delete one and add it again                                              |
| A blueprint may declare at most one Character role            | Remove all but one role in **Blueprint settings** → **Role**                                           |
| role "…" is declared but never bound by any stage _(warning)_ | Bind a stage's slot to the role, or remove the role                                                    |
| memory key "…" is written by multiple stages _(warning)_      | Give each stage its own memory key. See [Connecting stages](../blueprints/connecting-stages.md#memory) |

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

| Message                                                           | What to do                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iterate.over a many-cardinality media source is not yet supported | Iterate over a list in `data`, not a set of files                                                                                                                                                                                            |
| iterate.over does not narrow to an array schema                   | **Over** must be a list: a memory key whose value is a list, or the previous stage's whole output when that is a list. **prev** with a path into a field isn't accepted. See [Iterate](../blueprints/iterate-conditions-approval.md#iterate) |
| alignWith:'item' requires … to declare iterate                    | Both stages must iterate                                                                                                                                                                                                                     |
| iterate.over does not align with "…"'s iterate.over …             | Both stages must iterate over the same list                                                                                                                                                                                                  |
| approval.mode "item" requires the stage to declare iterate        | Add **Iterate**, or use mode `stage`                                                                                                                                                                                                         |
| references unknown stage "…"                                      | **Retry stage** names a stage that doesn't exist                                                                                                                                                                                             |
| onReject target "…" comes after this stage in the graph …         | Choose this stage or an earlier one                                                                                                                                                                                                          |
| target stage "…" has no instructions template … _(warning)_       | Give that stage a Template so your rejection note has something to change                                                                                                                                                                    |

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
