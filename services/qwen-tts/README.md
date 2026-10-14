# Reelcraft Qwen3-TTS service

A small local service that runs [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
for Reelcraft's **Generate Speech** stage. It holds no model weights: Reelcraft's UI asks it to download
a model (from a pinned Hugging Face revision) the first time you choose one.

**You normally don't run this yourself.** Reelcraft installs and starts it from Settings → Qwen3-TTS
(local) → **Set up** (`apps/api/src/provider/qwen/qwen-runtime.service.ts`), in a local checkout and in
the Docker image, and stops it when idle. To run it yourself (for example to use a Mac's GPU from
Reelcraft in Docker), save its address in Settings, then:

```bash
pnpm tts                                     # from the repo root
# or
uv run --extra engine qwen-tts-service       # from this folder
```

It listens on `http://127.0.0.1:8091`. Tests: `uv run pytest` (the heavy model packages are an optional
`engine` extra, pinned in `constraints.txt`, so tests install only the light dependencies). After changing
dependencies, regenerate the pins:

```bash
uv lock && uv export --frozen --no-dev --extra engine --no-emit-project --no-hashes -o constraints.txt
```

The app installs the runtime with the same command CI runs (`.github/workflows/qwen-tts.yml`):

```bash
uv venv --python 3.12 venv
uv pip install --python venv/bin/python --torch-backend auto -r pyproject.toml --extra engine -c constraints.txt
```

`--torch-backend auto` makes uv pick the PyTorch build for the computer's GPU (CPU if none). The pins are
constraints (`-c`), not requirements, so wheels that only suit another platform are never installed.

| Environment variable       | Default                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `QWEN_TTS_MODELS_DIR`      | `~/.reelcraft/qwen-tts/models`                              |
| `QWEN_TTS_HOST`            | `127.0.0.1` (no login: keep it local)                       |
| `QWEN_TTS_PORT`            | `8091`                                                      |
| `QWEN_TTS_DEVICE`          | auto: CUDA, then Apple MPS, then CPU                        |
| `QWEN_TTS_IDLE_SECONDS`    | `600` (how long a loaded model stays in memory unused)      |
| `QWEN_TTS_EXIT_WITH_STDIN` | `1` makes it exit when its stdin closes (the app sets this) |
| `QWEN_TTS_ACCESS_LOG`      | `0` silences the access log (the app sets this)             |

## API

| Route                                                                | Does                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /health`                                                        | `service`, `api`, `pid`, `device`, `deviceLabel`, `reason`, `ready`, loaded model  |
| `GET /v1/models`                                                     | The two models and their state: `not_downloaded`, `downloading`, `ready`, `failed` |
| `POST /v1/models/{id}/download`, `/cancel`; `DELETE /v1/models/{id}` | Manage the weights on disk (deleting a linked model only forgets the link)         |
| `POST /v1/models/{id}/link` `{ path }`                               | Use model files the user already has, in place, after checking names and sizes     |
| `GET /v1/audio/voices`                                               | The nine voices                                                                    |
| `POST /v1/audio/speech`                                              | `{ model, input, voice, response_format, language, instructions }` → audio         |

The catalog (`src/qwen_tts_service/catalog.py`) is the only list of downloadable models, with each model's
pinned revision and file list; updating a revision there is a deliberate change. The service source is
baked into the Docker image, so changing it needs a `docker/app/RUNTIME_VERSION` bump.
