import hashlib
import re

import httpx
import pytest

from qwen_tts_service.catalog import CATALOG
from qwen_tts_service.store import ModelStore

SMALL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
BIG = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
WEIGHTS = b"w" * 3000
CONFIG = b'{"a": 1}'


class FakeHub:
    """A Hugging Face that serves one weights file (LFS, with a checksum) and one config."""

    def __init__(self):
        self.ranges: list[str | None] = []
        self.sha = hashlib.sha256(WEIGHTS).hexdigest()
        self.on_weights = lambda: None

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/api/models/" in url and "/tree/" in url:
            return httpx.Response(
                200,
                json=[
                    {"type": "file", "path": "README.md", "size": 5},
                    {"type": "file", "path": "config.json", "size": len(CONFIG)},
                    {
                        "type": "file",
                        "path": "speech_tokenizer/model.safetensors",
                        "size": len(WEIGHTS),
                        "lfs": {"oid": self.sha},
                    },
                    {"type": "directory", "path": "speech_tokenizer", "size": 0},
                ],
            )
        path = re.sub(r".*/resolve/[0-9a-f]+/", "", url)
        if path == "config.json":
            return httpx.Response(200, content=CONFIG)
        if path == "speech_tokenizer/model.safetensors":
            self.on_weights()
            header = request.headers.get("range")
            self.ranges.append(header)
            if header:
                start = int(header.removeprefix("bytes=").split("-")[0])
                return httpx.Response(206, content=WEIGHTS[start:])
            return httpx.Response(200, content=WEIGHTS)
        return httpx.Response(404)


@pytest.fixture
def hub():
    return FakeHub()


@pytest.fixture
def store(tmp_path, hub):
    return ModelStore(
        tmp_path / "models",
        client_factory=lambda: httpx.Client(transport=httpx.MockTransport(hub.handler)),
        run_in_thread=False,
    )


assert SMALL in CATALOG and BIG in CATALOG
