import numpy as np
import pytest

from qwen_tts_service.audio import encode

MAGIC = {"wav": b"RIFF", "flac": b"fLaC", "opus": b"OggS"}


@pytest.mark.parametrize("fmt", ["wav", "mp3", "flac", "opus"])
def test_encodes_every_format(fmt):
    wave = (np.sin(np.linspace(0, 440, 24000)) * 0.3).astype(np.float32)
    body, mime = encode(wave, 24000, fmt)
    assert len(body) > 100 and mime.startswith("audio/")
    if fmt in MAGIC:
        assert body[:4] == MAGIC[fmt]
