---
title: Automate Browser
description: Let Codex use a signed-in browser to do a task for you.
---

**Automate Browser** gives Codex a real web browser, with your **signed-in profile**, to carry out a
task, such as collecting information from a website you're logged in to, or finding and downloading
a sound effect, a piece of music or an image.

:::warning It acts as you

The browser is BrowserOS Neo's persistent profile. The task can act on **live accounts**, with your
logins, without asking again. Write the task carefully and use it only for things you're comfortable
automating.

:::

## What it makes

One of:

- **`data`**: structured information, described by a [schema](../blueprints/outputs.md).
- **`media.audio`**, **`media.image`** or **`media.video`**: one file the browser downloads.
- **Image list** or **video list**: several downloaded files, in order, up to **maxFiles**.

With a file output, the browser downloads the files and they become the stage's output like any other
audio, image or video, so later stages (for example [Render Timeline](./render-timeline.md)) can use
them. Reelcraft checks that each file is the kind the output says, and that it isn't empty.

For a file output the stage needs **Instructions** that say what to find, such as
`Find a short pencil scribble sound effect`. A list can't iterate or be written to memory. To collect
several single files, iterate a stage with one file output instead.

## Providers and models

**Codex** with **BrowserOS Neo**. Both need setting up first: see [Connect Codex](../codex.md) and
[BrowserOS Neo](../browseros-neo.md). If either isn't ready, the model picker says why.

## Inputs

None. The task is the stage's **Instructions**. Describe what the browser should do and what to
return. See [Prompts](../blueprints/prompts.md).

## Settings

Under **Config**:

- **startUrl**: a web address to open first. It must start with `http://` or `https://`.
- **maxFiles**: the most files a list output downloads, from 1 to 50 (default 10).

## Downloading files and licences

The browser is told to prefer files that are free to use and to read the licence on the page. It
records where each file came from, the licence the page states and the author in the stage's log, and
for a video list on each clip. **You are responsible for each site's licence and terms of use**, and
for crediting authors where the licence asks for it. Check the log before you publish.

A file larger than the output limit (16 MB by default) isn't accepted. If the browser can't find a
suitable file or the licence isn't clear, the stage fails with the reason it gives.

## Cost

Uses your ChatGPT plan through Codex. There's no per-use bill from Reelcraft.

## Tips

- Keep the task narrow and ask for a specific result in the schema.
- Add [human approval](../blueprints/iterate-conditions-approval.md#human-approval) if the result
  matters.

## Example

"Look up price": **startUrl** `https://example.com/products`, instructions `Find the price of {{ product }} and return it`, with a `data` output of `{ price: number }`.
