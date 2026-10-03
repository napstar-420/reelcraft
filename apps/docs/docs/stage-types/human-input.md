---
title: Human Input
description: Pause the run so a person can type or paste something in.
---

**Human Input** stops the run and waits for you to give it a value, such as a topic you want to decide
mid-way, a script you've written yourself, or a choice among options.

## What it makes

A `text` or `data` output, whichever you choose.

## Inputs

None. It has no slots and no model.

## Settings

None. Choose the output. For `data`, describe its fields with a [schema](../blueprints/outputs.md),
and the form is built from it.

## How it works

1. When the run reaches the stage, it pauses as **Paused Input**.
2. Open the run, and select **Provide input** on the stage. A dialog opens, titled **Provide input for**
   the stage:
   - for `text`, a box to type in;
   - for `data`, a **Form** built from the schema, and a **Raw JSON** tab to paste JSON instead.
3. Submit. If it passes the stage's [checks](../blueprints/checks.md), the run continues.

If a check fails, you're told what's wrong and can submit again. There's no quality control on this
stage, because you're the judge, only checks.

Costs nothing, and the run doesn't spend anything while it waits. See
[When a run needs you](../runs/when-a-run-needs-you.md).

## Tips

- Use it to put a person in the loop at the start, for example "write the script yourself".
- A required run [input](../blueprints/settings.md#inputs) is simpler when the value is known before
  the run starts. Use Human Input for things decided during the run.
- Add a check such as `word_count` to catch a missing or too-short answer.

## Example

"Pick topic": a `text` output, followed by a Generate Text stage that uses it as context.
