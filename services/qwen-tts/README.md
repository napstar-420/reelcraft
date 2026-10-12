# Reelcraft Qwen3-TTS service

A small local service that runs [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
for Reelcraft's **Generate Speech** stage. It holds no model weights: Reelcraft's UI asks it to download
a model (from a pinned Hugging Face revision) the first time you choose one.

```bash
pnpm tts                      # from the repo root
# or
uv run qwen-tts-service       # from this folder
```

It listens on `http://127.0.0.1:8091`. Tests: `uv run pytest`.

| Environment variable    | Default                               |
| ----------------------- | ------------------------------------- |
| `QWEN_TTS_MODELS_DIR`   | `~/.reelcraft/qwen-tts/models`        |
| `QWEN_TTS_HOST`         | `127.0.0.1` (no login: keep it local) |
| `QWEN_TTS_PORT`         | `8091`                                |
| `QWEN_TTS_DEVICE`       | auto: CUDA, then Apple MPS, then CPU  |
| `QWEN_TTS_IDLE_SECONDS` | `600`                                 |

## API

| Route                                                                | Does                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /health`                                                        | Status, device, loaded model                                                       |
| `GET /v1/models`                                                     | The two models and their state: `not_downloaded`, `downloading`, `ready`, `failed` |
| `POST /v1/models/{id}/download`, `/cancel`; `DELETE /v1/models/{id}` | Manage the weights on disk                                                         |
| `GET /v1/audio/voices`                                               | The nine voices                                                                    |
| `POST /v1/audio/speech`                                              | `{ model, input, voice, response_format, language, instructions }` → audio         |

The catalog (`src/qwen_tts_service/catalog.py`) is the only list of downloadable models; updating a
revision there is a deliberate change.
