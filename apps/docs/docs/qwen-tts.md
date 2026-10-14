---
title: Qwen3-TTS on your computer
description: Run the open Qwen3-TTS voice models locally for free voice-over, and download a model from inside Reelcraft.
---

**Qwen3-TTS** is an open speech model from Alibaba's Qwen team (Apache-2.0 licence). Reelcraft can use it
for [Generate Speech](./stage-types/generate-speech.md) instead of a paid service: it runs on your own
computer, costs nothing per request, and no text leaves it.

It works through a small **service** that you start on your computer. Reelcraft does not include the
model. You download it, from inside Reelcraft, the first time you choose it.

## What you need

- [`uv`](https://docs.astral.sh/uv/), which sets up Python and the service's packages for you.
- Disk space: **2.5 GB** for the 0.6B model, **4.6 GB** for the 1.7B model, plus the service's packages
  (a few GB).
- A computer that can run it. A graphics card (NVIDIA) or an Apple Silicon Mac is much faster than a
  plain processor, and the service picks the fastest it finds. How fast depends on your machine:
  try a short line first.

## Start the service

From the Reelcraft folder:

```bash
pnpm tts
```

The first start installs the packages, which takes a few minutes. Leave it running while you use
Reelcraft. It listens on `http://127.0.0.1:8091`, which is where Reelcraft looks.

If you run Reelcraft from the Docker image, there is no Reelcraft folder. Download the
`services/qwen-tts` folder from the repository, run `uv run --extra engine qwen-tts-service` in it, then set the
service address in **Settings → Qwen3-TTS (local)** to `http://host.docker.internal:8091`. If the
container still can't reach it, start the service with `QWEN_TTS_HOST=0.0.0.0`. The service has no
login, so only do that on a network you trust.

## Download a model

1. Open a **Generate Speech** stage, or the **Speech and audio** [default](./channels/defaults.md).
2. Choose **Qwen3-TTS (local)** as the provider. Reelcraft shows both models and tells you each needs a
   download first.
3. Select **Download** on the one you want, check the size and free space, and confirm.
4. Watch the progress. **Cancel** stops it, and a later download carries on where it left off.
5. When it finishes, select the model, then pick a voice and settings as usual.

Reelcraft never downloads a model on its own, and a run never starts a download.

To free the space, go to **Settings → Qwen3-TTS (local)** and select **Delete** beside a model.

## Where things are kept

Models are saved in `~/.reelcraft/qwen-tts/models` on your computer, outside Reelcraft's database,
backups and exported packages. Set `QWEN_TTS_MODELS_DIR` before starting the service to use another
folder.

| Setting                  | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `QWEN_TTS_MODELS_DIR`    | Where models are saved                                           |
| `QWEN_TTS_HOST`, `_PORT` | Where the service listens (default `127.0.0.1` and `8091`)       |
| `QWEN_TTS_DEVICE`        | Force `cuda:0`, `mps` or `cpu` instead of choosing automatically |
| `QWEN_TTS_IDLE_SECONDS`  | How long a loaded model stays in memory unused (default 600)     |

## If it fails

- **"The Qwen3-TTS service isn't running"**: start it with `pnpm tts`. Check the address in
  **Settings → Qwen3-TTS (local)** and select **Test connection**.
- **"Not enough disk space"**: free some space, or delete the other model.
- **The download failed or failed its checksum**: select **Try again**. Files already downloaded are
  kept.
- **A run fails with "isn't downloaded"**: download the model, as above.
- **Very slow**: on a plain processor a long script takes a while. Try the 0.6B model, or a shorter
  text, or use a computer with a graphics card.
