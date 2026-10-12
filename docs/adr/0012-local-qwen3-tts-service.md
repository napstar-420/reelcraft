# ADR 0012: Qwen3-TTS runs as a separate local service, with weights downloaded on request

- Status: accepted
- Date: 2026-10-12

## Context

We want free, private voice-over from the open Qwen3-TTS models. They are PyTorch models (2.5 GB and
4.6 GB), and Reelcraft's API and Docker image are Node-only. The weights must never live in the
repository, and users must not pay for storage they didn't ask for.

## Decision

- **A separate Python service** (`services/qwen-tts`, started by the user with `pnpm tts`) loads the
  model and serves an OpenAI-style `/v1/audio/speech`. The API reaches it by URL (Settings, then
  `QWEN_TTS_URL`, then `http://127.0.0.1:8091`).
- **The service downloads the weights**, only when the user confirms in the app, from a pinned
  Hugging Face revision of two allow-listed repos, verifying size and SHA-256, into a folder outside the
  repo. The API relays download, cancel and delete; the browser never talks to the service.
- **The provider always lists both models** with their download state. A model that isn't downloaded
  can't be picked, and stage validation rejects it (a stopped service is only a warning).

## Alternatives

- **Python inside the API or image:** adds gigabytes to the image for everyone and forces a
  `RUNTIME_VERSION` bump and updater changes.
- **Docker for the service:** containers on a Mac can't use the Apple GPU, the slowest option for the
  likeliest user.
- **Calling a hosted Qwen API (DashScope, OpenRouter):** works, but is paid and sends text away.

## Consequences

- The user starts a second process, and Docker users must point the app at it.
- The service has no login and listens on localhost only by default.
- The model's catalog (revisions, sizes) lives in the service; a small fallback copy in the API lets
  the editor show both models when the service is stopped.
- Speed on a given machine is unknown until tried, and Docker users on a Mac get CPU only.
