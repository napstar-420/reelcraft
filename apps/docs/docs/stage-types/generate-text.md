---
title: Generate Text
description: Write a script, structured data or a timeline with an AI model.
---

**Generate Text** asks an AI model to answer a prompt. It's the most common stage: it writes scripts,
plans scenes, writes captions and even arranges a timeline.

## What it makes

Choose the stage's [output](../blueprints/outputs.md):

- **`text`**: plain text, such as a script.
- **`data`**: a structured JSON object that follows a schema you describe, such as a list of scenes.
  The model must answer in that shape.
- **`timeline`**: an edit plan for a video. See [Timelines](../video/timelines.md).

## Providers and models

Any text model: **OpenRouter** (many vendors), **Codex** or **ChatGPT** (your ChatGPT plan), or **Fake
(test)**. Choose one under **Model**, or set a **Text** [default](../channels/defaults.md). For a
`data` output, an OpenRouter model must support structured output; Reelcraft tells you if it
doesn't.

## Inputs

It has no slots. Everything it needs comes through the prompt, using values from
[context](../blueprints/connecting-stages.md#slots-and-context). Write your instructions in
**Instructions** with `{{ }}` values. See [Prompts](../blueprints/prompts.md).

To let the model see a file, such as an image, bind it under **Context** and tick **Attach file**.
Reelcraft checks that the chosen model can read that kind of file and how many it accepts per request.

## Settings

None of its own. The model's **Effort**, **Web search** and **Params** are under **Model**. See
[Models](../blueprints/models.md).

## Cost

Paid by the amount of text, if the provider is OpenRouter. With Codex or ChatGPT, it uses your
ChatGPT plan instead of an API bill. Fake is free.

## Tips

- Use a `data` output with a schema when a later stage needs separate pieces, such as one scene per
  image.
- Add a [check](../blueprints/checks.md) such as `word_count`, then [quality
  control](../blueprints/quality-control.md) for what rules can't judge.
- If the model can't do the task, it says so, and the stage fails with a clear message. See
  [Prompts](../blueprints/prompts.md#when-the-model-cant-do-the-job).

## Example

A stage named "Write script" with a `data` output whose schema has `title` (text) and `scenes` (a
list of objects with `narration` and `visual`). Its Template: `Write a 30-second script about {{ topic }}, in 4 scenes.` Later stages read `scenes` with a path.
