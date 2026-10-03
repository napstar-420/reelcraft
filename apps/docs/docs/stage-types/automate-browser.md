---
title: Automate Browser
description: Let Codex use a signed-in browser to do a task for you.
---

**Automate Browser** gives Codex a real web browser, with your **signed-in profile**, to carry out a
task, such as collecting information from a website you're logged in to.

:::warning It acts as you

The browser is BrowserOS Neo's persistent profile. The task can act on **live accounts**, with your
logins, without asking again. Write the task carefully and use it only for things you're comfortable
automating.

:::

## What it makes

A `data` output, described by a [schema](../blueprints/outputs.md). The stage requires it.

## Providers and models

**Codex** with **BrowserOS Neo**. Both need setting up first: see [Connect Codex](../codex.md) and
[BrowserOS Neo](../browseros-neo.md). If either isn't ready, the model picker says why.

## Inputs

None. The task is the stage's **Instructions**. Describe what the browser should do and what to
return. See [Prompts](../blueprints/prompts.md).

## Settings

Under **Config**:

- **startUrl**: a web address to open first. It must start with `http://` or `https://`.

## Cost

Uses your ChatGPT plan through Codex. There's no per-use bill from Reelcraft.

## Tips

- Keep the task narrow and ask for a specific result in the schema.
- Add [human approval](../blueprints/iterate-conditions-approval.md#human-approval) if the result
  matters.

## Example

"Look up price": **startUrl** `https://example.com/products`, instructions `Find the price of {{ product }} and return it`, with a `data` output of `{ price: number }`.
