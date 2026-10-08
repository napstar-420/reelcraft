---
title: Generate Image
description: Make an image from a prompt, optionally guided by reference images or a character.
---

**Generate Image** makes one picture from a prompt.

## What it makes

A single `media.image` output.

## Providers and models

OpenRouter image models, **Codex** (needs its image extension, see [Connect Codex](../codex.md)),
**ChatGPT** (through BrowserOS Neo, see [BrowserOS Neo](../browseros-neo.md)), or **Fake (test)**.
Choose one under **Model** or set an **Images** [default](../channels/defaults.md). If a provider
can't make images right now, the model picker says why.

## Inputs

- **`references`** (optional, `many`): images the model should take after, such as a style sample or
  a character. Bind it to an image from the previous stage, an input, an asset, or a
  [character role](../channels/characters.md).

The prompt is the **Template** in **Instructions**. See [Prompts](../blueprints/prompts.md). When a
character is bound, its description is added to the prompt for you.

## Settings

None of its own. The format, such as the aspect ratio, comes from the model. See
[Models](../blueprints/models.md).

## Cost

Paid per image by the provider, or your ChatGPT plan for Codex and ChatGPT. Fake is free.

ChatGPT image chats are archived automatically after each image, so they don't pile up in your ChatGPT
history. You can still find them under Settings > Data controls > Archived chats.

## Tips

- To make one image per scene, [iterate](../blueprints/iterate-conditions-approval.md#iterate) over
  the scenes, bind a context entry named `visual` to **item** with the path `visual`, and use
  `{{ visual }}` in the prompt.
- For the same character in every image, bind a [role](../channels/characters.md) to `references`.
- [Quality control](../blueprints/quality-control.md) can look at the image: the judge sees the
  picture itself.

## Example

"Scene image": iterates over the `scenes` memory key, with a context entry `visual` bound to the item's
`visual` field, the Template `{{ visual }}, vertical, cinematic lighting`, and `references` bound to the host character's role.
