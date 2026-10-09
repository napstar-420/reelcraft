---
title: Generate Image
description: Make an image, or several, from a prompt, optionally guided by reference images or a character.
---

**Generate Image** makes one picture from a prompt, or several pictures from the same prompt.

## What it makes

By default, a single `media.image` output.

To get several pictures from one prompt, open **Output & memory writes** and change **Output** to
`media.image_list`. The stage then makes an **image list**: all its images in order, stored together. Each
image shows in the stage's output, where you can open or download it.

To make several candidates and keep only the best one, see [Pick the best of several](#pick-the-best-of-several).

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

The format, such as the aspect ratio, comes from the model. See [Models](../blueprints/models.md).

With the `media.image_list` output, two more settings appear under **Output**:

- **Number of images**: how many images one run makes, from 2 to 8. It starts at 4.
- **If fewer images come back**: what to do when the provider returns fewer images than you asked for.
  - **Warn and continue** (the default) keeps the images that did come back and notes the shortfall in
    the stage's log. The stage carries on with them.
  - **Fail and retry** counts the attempt as a provider error and tries again, the same as any other
    crash, until the stage's **Retry limit** under **Execution (retry, budget)** runs out. Then the
    stage fails with `The provider returned 2 of 4 images` (with your numbers). You still pay for the
    attempts that came back short. If no image comes back at all, the attempt fails either way.

How many images each provider makes:

- **OpenRouter** is asked for exactly that many, and is billed for each.
- **Codex** is asked to make that many and to return them all.
- **ChatGPT** has no setting for it. The number is asked for in the message, and you get the images
  ChatGPT puts in its reply, up to that many. Use **Warn and continue** if it often makes fewer.
- **Fake (test)** returns that many copies of a test picture.

An image list can't [iterate](../blueprints/iterate-conditions-approval.md#iterate) or write to
memory. Bind it from the next stage with **Previous stage**. To make a different picture for each
scene, iterate with a single `media.image` output instead.

## Pick the best of several

Keep the **Output** as `media.image` (one image) and let [quality control](../blueprints/quality-control.md#picking-the-best-image)
choose between candidates:

1. Under **Output & memory writes**, with **Output** on `media.image`, tick **Make several candidates
   and let quality control pick the best**.
2. Set **Number of candidates**, from 2 to 4. It starts at 3.
3. Turn on **Quality control** for the stage, with a judge that can look at images. Without it the
   blueprint shows **Picking the best of several images needs quality control**.

Each attempt makes all the candidates. The judge looks at them together, picks the best one, and scores
that image against your criteria.

- If the score reaches the **Threshold**, the stage's output is **that one image**. It is a normal
  image, so a later stage can use it anywhere an image fits, such as `startFrame`, and the stage can
  [iterate](../blueprints/iterate-conditions-approval.md#iterate) or write to memory. The run page shows
  it with the other candidates beside it, the chosen one marked **Chosen**.
- If the score is below the **Threshold**, every candidate is rejected and **all are made again**, with
  the judge's critique added to the prompt, up to the quality control **Max attempts**. When those run
  out, the stage fails, or goes to a person if **When attempts run out** is **Hand off to human review**. The
  person sees the best candidate of the last round.
- Your **Checks** run on every candidate first. A candidate that fails a check is dropped and the judge
  doesn't see it. If every candidate fails, the attempt fails its checks and is made again.
- **If fewer images come back** works as it does for an image list. The judge picks from the candidates
  that did come back.

You pay for all the candidates on every attempt, including the attempts that are rejected.

## Cost

Paid per image by the provider, or your ChatGPT plan for Codex and ChatGPT. Fake is free.

ChatGPT image chats are archived automatically after each image, so they don't pile up in your ChatGPT
history. You can still find them under Settings > Data controls > Archived chats. ChatGPT archives a chat
at once, but its sidebar can keep listing it for many minutes.

## Using an image list

A later stage can use the list with **Previous stage**, in a slot that takes many images, such as
`references` on Generate Image or Generate Video. It can't go in a slot that takes one image, such as
`startFrame`. The blueprint shows **an image list needs a cardinality:'many' slot** if you try. Images
from a list can also be put on a [timeline](./human-timeline-edit.md).

The images are made, judged, approved and made again **together**: one weak image means the whole set is
made again, and you pay for all of it. If you need to redo pictures one by one, iterate instead.

## Tips

- To make one image per scene, [iterate](../blueprints/iterate-conditions-approval.md#iterate) over
  the scenes, bind a context entry named `visual` to **item** with the path `visual`, and use
  `{{ visual }}` in the prompt.
- For the same character in every image, bind a [role](../channels/characters.md) to `references`.
- [Quality control](../blueprints/quality-control.md) can look at the image: the judge sees the
  picture itself. For an image list it sees every image together and accepts or rejects the whole set.
  See [Image lists](../blueprints/quality-control.md#image-lists). To keep the best of a few tries as one
  image, see [Pick the best of several](#pick-the-best-of-several).

## Example

"Scene image": iterates over the `scenes` memory key, with a context entry `visual` bound to the item's
`visual` field, the Template `{{ visual }}, vertical, cinematic lighting`, and `references` bound to the host character's role.
