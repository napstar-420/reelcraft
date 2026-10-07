---
title: Troubleshooting
description: Fixes for common problems running Reelcraft in Docker.
---

## Looking at the logs

Most problems are explained in Reelcraft's log.

- **Docker Desktop:** open **Containers**, click **reelcraft**, and open the **Logs** tab.
  {/* Screenshot: docker-desktop/logs.png */}
- **Command line:** `docker logs --tail 200 reelcraft`

Every part of Reelcraft (the app, database, storage and job runner) writes to this one log. A few
lines from Inngest on every start, `rejecting event; event key not recognized` and a
`traces export` 404, are harmless.

## The page doesn't load

- The first start takes one to three minutes. Wait and refresh.
- Check that the **reelcraft** container is running in Docker Desktop's **Containers** list
  (`docker ps` on the command line). After it has started, its status says **healthy**.
- Check that you're opening the host port you chose: [http://localhost:8080](http://localhost:8080) by default.

## "Port is already allocated"

Another program already uses port 8080, and Docker can't start Reelcraft on it. Delete the
container and run it again with another **host port**, such as `8090`, and the same volume. Then
open [http://localhost:8090](http://localhost:8090). See [Using a different port](./run-reelcraft.md#using-a-different-port).

## The container stops by itself

Open the [logs](#looking-at-the-logs) and look at the last lines.

- **The database update failed:** Reelcraft stops rather than run on a half-updated database.
  [Open an issue](#getting-help) with the log.
- **No space left on device:** Docker's disk is full. Free space in Docker Desktop
  (**Images**: delete unused images) or on your computer, then start Reelcraft again.

## Reelcraft is slow, or rendering fails

Rendering video uses a lot of memory. Give Docker at least 4 GB (macOS and Linux: Docker Desktop
**Settings → Resources**), and close other large apps while rendering.

## BrowserOS Neo test fails

**Test connection** in [Settings → BrowserOS Neo](./browseros-neo.md) says why it failed. A plain
`fetch failed` means Reelcraft couldn't reach Neo at all:

- Is Neo open, and is its MCP server on?
- Does the address use **`host.docker.internal`** (not `localhost` or `127.0.0.1`), with the port
  and path Neo shows?
- **Linux with Docker Engine:** was the container started with
  `--add-host=host.docker.internal:host-gateway`? Does Neo's MCP server accept connections from
  outside `127.0.0.1`?
- A firewall on your computer may block the connection from Docker.

## Codex sign-in doesn't finish

- **"Codex did not show a sign-in code"**: Reelcraft couldn't reach OpenAI. Check your internet
  connection and click **Connect Codex** again.
- **"The sign-in code expired"**: codes last 15 minutes. Click **Connect Codex** again.
- **"Codex sign-in is already in progress"**: another sign-in is still waiting, perhaps in another
  tab. Click **Cancel** on it, or wait for it to finish.
- **Neo didn't enter the code**: the Codex card says why, under **BrowserOS Neo:**. Use the link
  and code shown instead. See [Without BrowserOS Neo](./codex.md#without-browseros-neo).

## "Saved key can't be read"

The key that unlocks saved provider keys (in `/data/secrets.env`) changed, usually because the
volume was restored without it. Click **Remove** next to the key in Settings, then paste the key
again. See [How keys are stored](./provider-keys.md#how-keys-are-stored).

## An update didn't work

If a new version doesn't start, Reelcraft goes back to the previous one on its own, and the
**Updates** window says **The update to X.Y.Z didn't work** with the reason. Your data is restored
from the backup taken before the update. You can try again later, or
[move to the new image](./updating.md#update-to-a-new-image) instead.

**Could not check for updates** usually means Reelcraft couldn't reach GitHub. It tries again on
its own every 6 hours.

## Generate Speech fails

- **"no voice is chosen"**: ElevenLabs voices belong to your account, so a Generate Speech stage needs
  one chosen under **Model → Voice**.
- **"Free users cannot use library voices via the API"**: your ElevenLabs plan can only use premade
  voices through the API. Choose a premade voice or upgrade the plan.
- **"the key was rejected"**: the key under **Settings** is wrong or lacks a permission. Click **Test**.

See [Generate Speech](./stage-types/generate-speech.md#if-it-fails).

## Deepgram transcription doesn't work

Deepgram needs to reach your Reelcraft over the internet, which a desktop install doesn't allow.
See [the note on the providers page](./provider-keys.md#the-services).

## Getting help

[Open an issue on GitHub](https://github.com/napstar-420/reelcraft/issues) with what you did, what
happened, your Reelcraft version (shown at the bottom of the sidebar), and the last lines of the
[log](#looking-at-the-logs). Check that the log you paste contains no API keys.
