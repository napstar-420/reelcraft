import os
from pathlib import Path

import uvicorn

from .app import create_app
from .engine import Engine
from .store import ModelStore


def main() -> None:
    root = Path(
        os.environ.get("QWEN_TTS_MODELS_DIR") or Path.home() / ".reelcraft" / "qwen-tts" / "models"
    )
    store = ModelStore(root)
    engine = Engine(store.path, device=os.environ.get("QWEN_TTS_DEVICE") or None,
                    idle_seconds=float(os.environ.get("QWEN_TTS_IDLE_SECONDS", "600")))
    # 127.0.0.1 by default: the service has no login, so it is only for this computer.
    uvicorn.run(
        create_app(store, engine),
        host=os.environ.get("QWEN_TTS_HOST", "127.0.0.1"),
        port=int(os.environ.get("QWEN_TTS_PORT", "8091")),
    )


if __name__ == "__main__":
    main()
