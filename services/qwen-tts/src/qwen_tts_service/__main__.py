import os
import sys
import threading
from pathlib import Path

import uvicorn

from .app import create_app
from .engine import Engine
from .store import ModelStore


def exit_with_parent() -> None:
    """Exits when the app that started this service goes away.

    The Reelcraft API starts the service with a pipe as its stdin and keeps it open. When the API
    ends for any reason (Ctrl-C, a restart, a crash, being killed) the pipe closes and the read
    below returns, so the service never outlives it. This works the same on every OS, unlike
    signals or process groups."""

    def wait() -> None:
        try:
            while sys.stdin.buffer.read(65536):
                pass
        except (OSError, ValueError):
            pass
        os._exit(0)

    threading.Thread(target=wait, daemon=True).start()


def main() -> None:
    root = Path(
        os.environ.get("QWEN_TTS_MODELS_DIR") or Path.home() / ".reelcraft" / "qwen-tts" / "models"
    )
    store = ModelStore(root)
    engine = Engine(
        store.path,
        device=os.environ.get("QWEN_TTS_DEVICE") or None,
        idle_seconds=float(os.environ.get("QWEN_TTS_IDLE_SECONDS", "600")),
    )
    if os.environ.get("QWEN_TTS_EXIT_WITH_STDIN") == "1":
        exit_with_parent()
    # 127.0.0.1 by default: the service has no login, so it is only for this computer.
    uvicorn.run(
        create_app(store, engine),
        host=os.environ.get("QWEN_TTS_HOST", "127.0.0.1"),
        port=int(os.environ.get("QWEN_TTS_PORT", "8091")),
        # The app polls /v1/models, which would flood the log it shows; it turns this off.
        access_log=os.environ.get("QWEN_TTS_ACCESS_LOG", "1") != "0",
    )


if __name__ == "__main__":
    main()
