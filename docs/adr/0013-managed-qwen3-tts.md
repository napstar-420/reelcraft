# ADR 0013: Reelcraft installs and runs the Qwen3-TTS service itself, on request

- Status: accepted
- Date: 2026-10-14
- Supersedes: the "started by the user with `pnpm tts`" part of [ADR 0012](0012-local-qwen3-tts-service.md),
  and its rejection of Python in the image (the image now carries `uv` and the service's source, still no
  Python packages or models).

## Context

ADR 0012 made Qwen3-TTS a separate local service that the user starts by hand. That left new users at a dead
end ("start it with `pnpm tts`"), and Docker users with no way to run it at all: the image had no `uv`, and
the source was not in it. We want a **Set up** button that works in a local checkout and in the image, on
Windows, macOS and Linux, that uses the GPU when there is one and the CPU otherwise, and that never installs
or downloads anything the user didn't confirm after seeing its size.

## Decision

- **The API manages the service** (`QwenTtsRuntime`, `apps/api/src/provider/qwen/`). With no address saved it
  is _managed_: it installs the packages with `uv`, runs the service as a child process, and stops it. With an
  address saved (Settings, or `QWEN_TTS_URL`) it is _external_ and never installs or spawns anything: the
  user runs the service. That is also how Docker on a Mac can use the Mac's GPU.
- **Install**: `uv venv --python 3.12` then `uv pip install --torch-backend auto -r pyproject.toml --extra
engine -c constraints.txt`, into a folder the app owns (`~/.reelcraft/qwen-tts`, or `/data/qwen-tts` in the
  image). `--torch-backend auto` makes uv pick the PyTorch build for the computer's GPU, falling back to the
  CPU build; a failed install offers **Install for CPU instead**. `qwen-tts` is an optional `engine` extra of
  the service, pinned by a committed `constraints.txt` (an `uv export` of the lock) used as _constraints_, so
  the lock's Linux CUDA wheels are never forced onto CPU machines. The service runs from source
  (`PYTHONPATH`), directly with the environment's Python, not through `uv run`, so stopping it kills the
  real process on every OS.
- **Lazy**: speech and model actions start an installed-but-stopped service; listing, status and the connection
  test never do (the UI polls them). It stops after 10 minutes unused (not while a request is in flight or a
  model is downloading) and when the API stops. A service already answering `/health` with our service id
  (the user ran `pnpm tts`) is adopted and never stopped.
- **Never orphaned**: the service exits when its stdin pipe closes (`QWEN_TTS_EXIT_WITH_STDIN=1`). The OS closes
  the pipe when the API dies however it dies (Ctrl-C, a `nest --watch` restart, SIGKILL), the same on all
  OSes. We did not add global shutdown hooks or a PID file.
- **Children get an allowlisted environment**, never `process.env`, which holds the database password and
  provider keys.
- **Docker**: the image adds `uv` (a pinned stage, `ghcr.io/astral-sh/uv`, amd64 and arm64) and the service's
  source at `/opt/reelcraft/qwen-tts`, outside the app bundle that in-app updates replace. The packages, the
  uv cache, the managed Python and the models live in `/data/qwen-tts` (`UV_*` point there), so the image stays
  small and nothing is installed until the user asks. `/data/qwen-tts` is **excluded from the documented
  backups**. A change to the baked service files needs a `RUNTIME_VERSION` bump (CI checks it).
- **GPU in Docker** needs the host's help and is documented, not automatic: `--gpus all` (and the NVIDIA
  Container Toolkit on Linux, WSL 2 on Windows). Docker on a Mac can't use the Mac's GPU, so the UI tells Mac
  users to run the service on the Mac and save its address.
- **Existing weights**: the user can point a model at a folder they already have. The service checks file names
  and sizes against the model's file list (kept in its catalog) and records the path; it never copies,
  symlinks or writes into the folder, and deleting a linked model only forgets the link.

## Alternatives

- **Keep the user-started service** (ADR 0012): no code to manage a process, but a dead end for new users and
  impossible in the image.
- **Bake Python and PyTorch into the image**: gigabytes for everyone, including people who never use Qwen,
  and CUDA builds would make it worse. Installing on request keeps the image small.
- **`uv sync` with the lock**: reproducible, but it cannot pick a PyTorch build for the machine's GPU, and the
  lock carries Linux CUDA wheels that would be installed on CPU-only machines.
- **Download `uv` ourselves** when it is missing: more automatic, but means maintaining per-platform download
  links. For a local install we show the OS's install command and a Check again button instead.
- **Spawn with `detached` and a PID file**: survives an API restart, but orphans the service on an unclean
  exit and risks PID reuse. The stdin pipe needs neither.

## Consequences

- A second process the API owns: a new state machine to maintain (`qwen-runtime.service.ts`), covered by unit
  tests with a fake child, and verified for real on macOS.
- The image gains `uv` and a small Python source folder; Docker users can set up Qwen3-TTS with no terminal
  (CPU only unless they pass an NVIDIA GPU in).
- Setup needs the internet (PyPI, the PyTorch index, GitHub for uv's managed Python, Hugging Face) the first
  time; it is not offline-capable.
- Pinned `torch`/`torchaudio` versions may be missing on some GPU indexes, or need a newer driver than a user
  has; the install fails clearly and the CPU build is one click away.
- NVIDIA, AMD and Intel GPUs, Windows, and GPU passthrough in Docker are not tested by us. CI installs and boots
  the service on Ubuntu, Windows and macOS runners, without a GPU.
- Restoring a backup brings back no Qwen3-TTS software or models: the user sets it up and downloads again.
- `uv` versions must match between the Dockerfile and `.github/workflows/qwen-tts.yml`, because
  `--torch-backend` behaves differently between versions.
