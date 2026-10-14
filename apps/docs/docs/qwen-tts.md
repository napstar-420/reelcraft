---
title: Qwen3-TTS on your computer
description: Free voice-over from the open Qwen3-TTS models, set up from inside Reelcraft, with your GPU when it has one.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

**Qwen3-TTS** is an open speech model from Alibaba's Qwen team (Apache-2.0 licence). Reelcraft can use it
for [Generate Speech](./stage-types/generate-speech.md) instead of a paid service: it runs on your own
computer, costs nothing per request, and no text leaves it.

Reelcraft sets it up for you. There is nothing to start by hand, and nothing is installed or
downloaded until you say so.

## Set it up

1. Open a **Generate Speech** stage (or the **Speech and audio** [default](./channels/defaults.md)) and
   choose **Qwen3-TTS (local)** as the provider. Or open **Settings → Qwen3-TTS (local)**.
2. Select **Set up Qwen3-TTS**. Reelcraft shows what it will install and how big it is, and how much
   disk space is free, and waits for you to confirm. This installs the **software** Qwen3-TTS runs on.
3. Watch the progress. **Cancel** stops it.
4. Select **Download** on the voice model you want, check its size, and confirm. The two models are
   shown together: **Qwen3-TTS 0.6B** (2.5 GB) and **Qwen3-TTS 1.7B** (4.5 GB).
5. When it finishes, select the model, then pick a voice and settings as usual.

Reelcraft never downloads or installs anything on its own, and a run never starts a download.

### It only runs while you use it

The first time you make speech, Reelcraft starts the service (a few seconds, plus loading the model).
After **about ten minutes** with nothing to do, it stops by itself and frees the memory, and starts
again for the next request. Under **Settings → Qwen3-TTS (local)** you can also **Stop** it, or
**Reinstall for this hardware**, for example after you add a graphics card.

To free the space, select **Delete** beside a model, in the same place. The software can be removed by
deleting its folder (see [Where things are kept](#where-things-are-kept)).

## What you need

- **Disk space.** The software is about **1.2 GB** on a Mac (measured). On other computers that is a
  guess, and a version for an NVIDIA graphics card is larger, so Reelcraft shows an estimate before it
  installs. The models are **2.5 GB** (0.6B) and **4.5 GB** (1.7B), downloaded separately.
- **Memory.** On a graphics card the 0.6B model needs roughly 3 GB of its memory and the 1.7B roughly
  5 GB. On the processor alone, roughly **4–5 GB** of RAM for the 0.6B and **9 GB or more** for the
  1.7B. These are estimates from the file sizes, not measurements. If memory is short, use the 0.6B
  model.
- **An internet connection** for the first setup (Python packages, a Python itself, and the model).
- **`uv`**, if Reelcraft runs directly on your computer rather than in Docker. It installs the software.
  If it is missing, Reelcraft shows the command for your computer and a **Check again** button. The
  Docker image already has it.

## Which processor it uses

Reelcraft picks the fastest one it finds and tells you, as **Running on:** in the setup panel:

| Your computer                       | What it uses                                            |
| ----------------------------------- | ------------------------------------------------------- |
| Mac with Apple Silicon (not Docker) | The Apple GPU                                           |
| NVIDIA graphics card                | The graphics card (see [Docker](#in-docker) for Docker) |
| Anything else                       | The processor, which is slower                          |

If the graphics card is out of memory or fails, Reelcraft retries on the processor and says why. The
setup installs the version of PyTorch for your computer (this is `uv`'s `--torch-backend auto`). If
the GPU version can't be installed, select **Install for CPU instead**.

The Apple GPU and the processor have been tested. NVIDIA graphics cards, AMD and Intel cards have not
been tested by the Reelcraft team yet.

## In Docker

Everything works inside the container, on the processor: the setup is the same, and the software and
models are kept in the `reelcraft-data` volume under `/data/qwen-tts`.

### Use an NVIDIA graphics card

Docker Desktop's **Run** button has no option for graphics cards, so start Reelcraft from a terminal,
with `--gpus all`. If a container named `reelcraft` already exists, stop and remove it first (your
data stays in the `reelcraft-data` volume), then run:

```bash
docker run -d --name reelcraft --restart unless-stopped --gpus all \
  -p 8080:8080 -v reelcraft-data:/data \
  zohaibkhan97/reelcraft
```

Then select **Reinstall for this hardware** under **Settings → Qwen3-TTS (local)** so the graphics
card version is installed.

<Tabs groupId="os" queryString>
<TabItem value="windows" label="Windows">

You need an up-to-date NVIDIA driver on Windows, and Docker Desktop with the **WSL 2** backend. See
[Docker's guide to GPU support in Docker Desktop](https://docs.docker.com/desktop/features/gpu/).

</TabItem>
<TabItem value="linux" label="Linux">

You need the NVIDIA driver and the **NVIDIA Container Toolkit** on your computer. See
[NVIDIA's install guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
On Docker Engine, also add `--add-host=host.docker.internal:host-gateway` as in
[Run Reelcraft](./run-reelcraft.md).

</TabItem>
</Tabs>

This has not been tested by the Reelcraft team. If the setup panel still says **No GPU is visible
inside Docker**, the card is not reaching the container.

### On a Mac

Docker on a Mac can't use the Mac's GPU, so Qwen3-TTS runs on the processor there, which is slow. For
faster speech, [run the service on the Mac itself](#use-a-service-you-run-yourself) and point Reelcraft
at it.

### Memory

Docker Desktop limits the memory containers get (**Settings → Resources**). The 1.7B model on the
processor needs more than the 4 GB the install guide asks for. Raise the limit, or use the 0.6B model.

## Where things are kept

Locally, the software, the models and a small `state.json` are in `~/.reelcraft/qwen-tts`. Set
`QWEN_TTS_HOME` to use another folder. In Docker they are in `/data/qwen-tts` in the volume.

They are **left out of [backups](./backup.md)**: a restored Reelcraft sets the software up again and
downloads the model again, when you ask it to.

| Setting                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `QWEN_TTS_HOME`         | Where the software and models are kept                           |
| `QWEN_TTS_URL`          | Use a service you run yourself instead (see below)               |
| `QWEN_TTS_DEVICE`       | Force `cuda:0`, `mps` or `cpu` instead of choosing automatically |
| `QWEN_TTS_IDLE_SECONDS` | How long a loaded model stays in memory unused (default 600)     |

## Use model files you already have

If you already downloaded a model, point Reelcraft at the folder instead of downloading it again. Under
a model that is not downloaded, open **Already have the files?**, type the folder's full path, and
select **Check folder**. Reelcraft checks that every file is there with the right size, and says which
are missing. The files are used where they are: nothing is copied or changed, and **Delete** only
forgets the folder. In Docker, the folder must be shared with the container, and the path is the one
inside it.

## Use a service you run yourself

You can run the Qwen3-TTS service yourself, on this computer or another one, and tell Reelcraft its
address. Then Reelcraft installs and starts nothing, and only uses it. This is also how Reelcraft in
Docker on a Mac can use the Mac's GPU.

1. Install [`uv`](https://docs.astral.sh/uv/). From the Reelcraft folder, run `pnpm tts`. Without a
   Reelcraft folder, download the `services/qwen-tts` folder from the repository and run
   `uv run --extra engine qwen-tts-service` in it. The first start installs the packages.
2. In **Settings → Qwen3-TTS (local)**, open **Use a service you run yourself**, enter the address
   (`http://127.0.0.1:8091`, or `http://host.docker.internal:8091` from Docker), and select **Save**.
   **Test connection** checks it. **Reset** goes back to letting Reelcraft manage it.

The service has no login and listens on `127.0.0.1`, so only this computer can reach it. If a Docker
container can't reach it, start it with `QWEN_TTS_HOST=0.0.0.0`, which opens it to your whole network:
do that only on a network you trust.

## If it fails

- **"Set up isn't available here"**: this copy of Reelcraft has no service to set up. Run one yourself,
  as above.
- **"Install uv first"**: run the command shown in a terminal, then select **Check again**.
- **"Not enough disk space"**: free some space, or delete the other model.
- **"The install failed"**: read the log under the message. If it is about PyTorch or your GPU, select
  **Install for CPU instead**.
- **"The service stopped unexpectedly"**: often not enough memory. Try the 0.6B model, or close other
  apps. **Start now** tries again.
- **"Can't reach the service you run yourself"**: start it, or **Reset** the address under
  **Settings → Qwen3-TTS (local)**.
- **The download failed or failed its checksum**: select **Try again**. Files already downloaded are
  kept.
- **A run fails with "isn't downloaded"** or "is not set up yet": set it up and download the model, as
  above.
- **Very slow**: on the processor a long script takes a while. Try the 0.6B model, a shorter text, or a
  computer with a graphics card.
