---
title: Connect Claude
description: Sign Reelcraft's built-in Claude Code in to your Claude plan from the Settings page.
---

[Claude Code](https://claude.com/claude-code) is Anthropic's coding agent. It comes with your
**Claude plan** (Pro or Max), and Reelcraft can use it for text and browser steps, for judging
quality, and for the assistant, instead of a paid API. The Claude Code program is
already installed inside Reelcraft; you only sign it in once.

Claude can't make images. For image steps, use Codex or a provider with image models.

You need:

- a Claude plan that includes Claude Code;
- for the easiest sign-in, [BrowserOS Neo](./browseros-neo.md) running and connected. Without Neo
  you can still sign in from any browser.

## Connect

1. In Reelcraft, open **Settings**. Find the **Claude** card and click **Connect Claude**.
2. Reelcraft opens Claude's sign-in page in **BrowserOS Neo**.
3. Switch to BrowserOS Neo. Sign in to your Claude account if asked, check that the page is
   Claude's (`claude.com`), and **approve the request**. Reelcraft never clicks this button for
   you.
4. After you approve, the page shows a code. Reelcraft picks it up from the Neo tab by itself,
   and the Claude card changes to **Connected** within a few seconds.

### Without BrowserOS Neo

If Neo isn't running, the Claude card shows a **Sign in to Claude** link and a box for the code:

1. Click the link, or open it in any browser on any device.
2. Sign in to your Claude account if asked, and approve the request.
3. Copy the code the page shows, paste it into the box on the Claude card and click
   **Finish sign-in**.

Click **Cancel** to stop a sign-in. A sign-in that isn't finished within 10 minutes stops by
itself; click **Connect Claude** again.

## What "Connected" shows

Once connected, the Claude card shows which plan you signed in with and lists what Claude can do
in Reelcraft:

- **Text**: available as soon as Claude is connected. This includes data and timeline outputs and
  judging quality, where Claude opens images and video clips itself.
- **Browser tasks**: needs BrowserOS Neo running. Claude reaches Neo at the address saved in the
  **BrowserOS Neo** card, so there is nothing else to set up.

To stop using your Claude plan in Reelcraft, click **Sign out**. **Reconnect Claude** signs in
again, for example with a different account.

The sign-in is kept in your volume (`/data/claude`), so it survives restarts and updates.

## Use Claude

- **Stages**: pick **Claude** as a stage's provider, then a model (**Claude Sonnet**,
  **Claude Opus**, **Claude Fable** or **Claude Haiku**) and an effort. Which models you can use
  depends on your plan.
- **The assistant**: pick **Claude** in the provider menu at the top of the assistant's chat. A
  chat keeps the provider it started with; switching starts a new chat.

Using Claude counts against your Claude plan's usage limits. Reelcraft records it as $0.

## Signing in from a terminal

If the Settings page doesn't work for you, you can sign in with a command instead. Open a terminal
(PowerShell on Windows) and run:

```bash
docker exec -it -u reelcraft reelcraft claude auth login
```

It prints the same link and asks for the code. This assumes your container is named `reelcraft`.
