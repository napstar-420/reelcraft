---
title: The assistant
description: Describe the video you want and let the assistant build or change the blueprint's stages for you.
---

The **Assistant** builds and edits a blueprint for you. Describe what you want ("a 30-second faceless
reel: script, voice-over, one image per scene, then render") and it proposes the stages, wired together
and checked, for you to apply.

It uses **Codex**, so you need to [connect Codex](../codex.md) first. If Codex isn't connected, the
Assistant tab says so and links to **Settings**.

## Open it

On the blueprint's canvas, open the **Assistant** tab in the panel next to the canvas. The first time,
you'll see a few example requests. Pick one or type your own and press **Enter**
(**Shift + Enter** starts a new line).

Pick the **Model** and its **Effort** at the top. They start as the model set in your Codex
configuration. A higher effort is slower and uses more of your ChatGPT plan.

## What it does, and what it can't

The assistant doesn't guess what Reelcraft can do. Before it uses a stage type, a model, a check, a
style, an asset or a character, it looks it up in **your** Reelcraft, so it only uses things that
exist on your computer, in the version you run. You see these steps as a collapsed line such as
**13 steps · Proposed a draft**. Select it to see each one.

Every proposal is checked with the same rules as **Save** before you see it. If the assistant gets
something wrong, it is told what and fixes it. It never shows you a blueprint that isn't runnable.

When you ask for something Reelcraft can't do, it says so, instead of faking it. For example, Reelcraft
can't publish a video to a platform, run stages in parallel, or create characters and assets for you.

It also can't save versions, start runs or approve anything. It only changes the blueprint on the
canvas (and its name, description and tags). **Save** is still yours: see [Versions](./versions.md).

## Proposals

A proposal appears as a card with a one-line summary, such as **2 stages added, 1 changed**. Select the
summary to see which stages, and which of their settings. Any warnings are listed on the card.

- **Apply** puts the change on the canvas. It's a normal edit: it shows as **Unsaved changes**, and you
  can keep editing or press **Save**.
- After applying, a message offers **Undo**.
- If you changed the canvas after the assistant started, the card says **The canvas changed since this
  was proposed**, and the button becomes **Apply anyway**. Applying then replaces your edits.

A proposal for the blueprint's **name, description or tags** works the same way: apply it, or undo.

## Auto-apply

Switch on **Auto-apply** at the top of the panel and the assistant's valid changes go onto the canvas
as soon as they're ready, with an **Undo** each time. It never applies over edits you made in the
meantime: those proposals wait for you, as in manual mode.

Auto-apply is remembered in this browser. It works while the blueprint is open on the canvas.

## Questions

When your request leaves a choice to you, the assistant asks. A question card lists the options, and
the last one is always **Other…**: choose it to type your own answer. Select **Send answers** to
continue. If you type a new message instead, the question is skipped.

## Chats

Each blueprint keeps its chats, so you can come back to one later. Open the **⋯** menu for:

- **New chat**: start fresh. Do this when a chat gets long or the assistant loses track.
- **Earlier chats**: pick an old one.
- **Delete chat**.

Select **Stop** (the square) to interrupt the assistant while it works.

After you update Reelcraft, a chat started before the update shows **Reelcraft was updated since this
chat started**. Select **Start new chat** so the assistant uses the new version's tools.

## Good to know

- The assistant sees this blueprint, its channel's defaults, assets and characters, and your
  conversation. That text goes to Codex, under your ChatGPT plan's terms. Your provider keys and
  settings never do.
- It works with the blueprint on the canvas, including edits you haven't saved. While you view an older
  version, the assistant is switched off.
- Codex usage counts against your ChatGPT plan, and a long chat uses more of it than a short one.
- If a request fails with a message from Codex, such as a model that isn't available to your account,
  pick another **Model** and send it again.
