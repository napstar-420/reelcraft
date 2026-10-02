---
title: Install Docker Desktop
description: Install Docker Desktop on Windows, macOS or Linux so you can run Reelcraft.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

Reelcraft runs inside Docker. **Docker Desktop** is the easiest way to get Docker: a normal app
with windows and buttons. It is free for personal use and small businesses. If you already have
Docker Desktop, skip to [Run Reelcraft](./run-reelcraft.md).

<Tabs groupId="os" queryString>
<TabItem value="windows" label="Windows">

1. Download **Docker Desktop for Windows** from
   [docker.com](https://www.docker.com/products/docker-desktop/). Most computers need the
   **AMD64** download; pick **ARM64** only for an ARM laptop (such as one with a Snapdragon chip).
2. Run the installer. Keep **Use WSL 2 instead of Hyper-V** selected.
3. Restart Windows if the installer asks you to.
4. Open **Docker Desktop** from the Start menu and accept the terms. You can skip signing in.
5. If Docker Desktop says WSL needs an update, open **PowerShell** and run `wsl --update`, then
   start Docker Desktop again.

Wait until the bottom-left corner of Docker Desktop says **Engine running**.

:::tip Memory

With WSL 2, Docker can use up to half of your computer's memory, which is usually enough. On a
computer with 8 GB, close other large apps while Reelcraft renders a video.

:::

</TabItem>
<TabItem value="macos" label="macOS">

1. Find out which chip your Mac has: open the **Apple menu → About This Mac**. It says **Apple M…**
   (Apple Silicon) or **Intel**.
2. Download **Docker Desktop for Mac** from
   [docker.com](https://www.docker.com/products/docker-desktop/), choosing **Apple Silicon** or
   **Intel** to match.
3. Open the downloaded `Docker.dmg` and drag **Docker** into **Applications**.
4. Open **Docker** from Applications and accept the terms. Allow it when macOS asks for your
   password. You can skip signing in.

Wait until the bottom-left corner of Docker Desktop says **Engine running**.

:::tip Memory

In Docker Desktop, open **Settings → Resources** and check that **Memory limit** is at least
**4 GB**. Click **Apply & restart** if you change it.

:::

</TabItem>
<TabItem value="linux" label="Linux">

You can use **Docker Desktop for Linux** or plain **Docker Engine** with the command line.

**Docker Desktop for Linux** (Ubuntu, Debian, Fedora and others): follow Docker's
[install guide for your distribution](https://docs.docker.com/desktop/setup/install/linux/),
then open Docker Desktop and wait until it says **Engine running**. In **Settings → Resources**,
give it at least **4 GB** of memory.

**Docker Engine** (no app, command line only): follow
[Docker's Engine install guide](https://docs.docker.com/engine/install/), then let your user run
Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in, and check that `docker run --rm hello-world` works.

</TabItem>
</Tabs>

**Next:** [Run Reelcraft](./run-reelcraft.md).
