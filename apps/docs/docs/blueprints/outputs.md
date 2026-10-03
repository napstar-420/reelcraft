---
title: Outputs
description: The kinds of output a stage can make, and how to describe structured data with the schema editor.
---

A stage's **Output** says what it makes. It's in the inspector's **Output & memory writes** section.
The next stages receive the output in that shape, so it also decides what they can do with it.

Each stage type only allows some output kinds, and the picker only lists those. A new stage starts
with the first one.

## Output kinds

| Kind             | What it is                                                  | Made by                                                     |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `text`           | Plain text, such as a script                                | Generate Text, Human Input                                  |
| `data`           | A structured JSON object that follows a schema you describe | Generate Text, Human Input, Analyze Media, Automate Browser |
| `timeline`       | An edit plan: which clips, text and captions go where       | Generate Text, Human Timeline Edit                          |
| `media.image`    | An image                                                    | Generate Image                                              |
| `media.video`    | A video                                                     | Generate Video, Concatenate Video, Render Timeline          |
| `media.audio`    | Audio, such as speech                                       | Generate Speech                                             |
| `file.subtitles` | A subtitle file (SRT or VTT)                                | Export Subtitles                                            |

You can't pick a kind a stage type doesn't allow. If a saved blueprint has one, it shows **capability
"…" does not allow output kind "…"**.

## Output instructions

A **Generate Text** stage with a `text` or `data` output also has **Output instructions**: guidance
about the content and style of the result. See [Prompts](./prompts.md#output-instructions).

## Describing `data`

When a stage's output is `data`, you describe its shape with a **schema**. The model is required to
answer in that shape, and later stages can pick fields out of it by name, such as `scenes` or
`title`. Without a schema, "a `data` output schema with no properties provides little type safety"
is shown as a warning.

The schema editor has two tabs.

### Visual

The top level is an object. For each field:

1. Select **+ Add property** and give it a name.
2. Choose its type: `string`, `number`, `integer`, `boolean`, `object` or `array`.
3. Tick **Required** if the model must always provide it.
4. Open the field with the arrow to add details:
   - an optional description, which helps the model understand what you want;
   - for text, number and whole-number fields, **Allowed values (comma-separated)** to limit the
     answer to a short list;
   - for text, **Min length** and **Max length**;
   - for numbers, **Minimum** and **Maximum**;
   - for a list, **Min items**, **Max items** and the **Item type**, which can itself be an object
     with its own properties.

**Remove** deletes a field.

### Raw JSON

The same schema as JSON, for pasting in or editing by hand. The tabs stay in sync.

### Extract from JSON

If you already have an example of the result you want, select **Extract from JSON**, paste the
example, and select **Extract**. Reelcraft works out the fields and their types from it. **It
replaces the current schema.** Check the result and tick **Required** where it matters.

## What a schema can't do

Schemas follow a deliberately small subset of JSON Schema, because AI models only reliably support a
subset. You can use `type`, `description`, allowed values, `properties`, `required`, list `items`,
and the minimum and maximum limits above.

You can't use `$ref`, `oneOf`, `anyOf`, `allOf`, `patternProperties` or `if`/`then`/`else`. If you
need a choice between shapes, use one object with optional fields, or an allowed-values field.

## Using a field from another stage

In a later stage, connect a slot to `prev` or `memory` and give a **path** such as `scenes` to use one
field. The path box suggests the fields from the schema, and Reelcraft checks at build time that the
path exists. See [Connecting stages](./connecting-stages.md#paths).
