---
slug: /
sidebar_label: Introduction
title: Reelcraft guide
description: Install Reelcraft on your own computer with Docker Desktop, connect your AI services, and keep it up to date.
---

Reelcraft makes AI videos and reels. It runs on **your own computer** as a single Docker
container: the app, its database, media storage and background jobs are all inside it. You use it
in your web browser, at [http://localhost:8080](http://localhost:8080).

This guide takes you from nothing installed to a working Reelcraft, then shows how to connect your
AI services, update it, and back it up. You don't need to be a developer, and you never need to
download Reelcraft's source code.

## What you need

- A 64-bit computer running **Windows 10 or 11**, **macOS** (Apple Silicon or Intel) or
  **Linux**.
- **8 GB of memory** or more. Docker should be allowed to use at least 4 GB of it.
- About **10 GB of free disk space** for Docker, the Reelcraft image and your first projects.
  Videos and images you make need more over time.
- **Docker Desktop**, which is free for personal use. [Install Docker Desktop](./install-docker.md)
  shows how.

## What's optional

Reelcraft starts with a free **test provider** that makes placeholder results, so you can try it
before paying for anything. To make real videos, connect one or more of these later:

| What                                  | Used for                                                     | Set up in                              |
| ------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| OpenRouter, fal, ElevenLabs, Deepgram | Paid AI services for text, images, video, voice and captions | [AI provider keys](./provider-keys.md) |
| BrowserOS Neo                         | Using your ChatGPT plan in a browser on your computer        | [BrowserOS Neo](./browseros-neo.md)    |
| Codex                                 | Using your ChatGPT plan through OpenAI's Codex               | [Connect Codex](./codex.md)            |

## Steps

1. [Install Docker Desktop](./install-docker.md)
2. [Run Reelcraft](./run-reelcraft.md)
3. [Add AI provider keys](./provider-keys.md), and if you use them, connect
   [BrowserOS Neo](./browseros-neo.md) and [Codex](./codex.md)

Then learn how to make videos: start with [How Reelcraft works](./concepts/how-it-works.md), then build a
[blueprint](./blueprints/blueprints.md) and [run it](./runs/starting-a-run.md).

Later: [update Reelcraft](./updating.md), [back it up](./backup.md), and
[fix common problems](./troubleshooting.md).

:::warning Keep it private

Reelcraft has no login. Anyone who can open its address can use it, and spend money through your
AI provider keys. Use it on your own computer or a network you trust, and never expose it to the
internet.

:::
