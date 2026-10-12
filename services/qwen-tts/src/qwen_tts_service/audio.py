"""Encodes generated speech into the formats Reelcraft can ask for."""

import io

import numpy as np
import soundfile as sf

#: format -> (soundfile format, subtype, MIME type)
FORMATS = {
    "wav": ("WAV", "PCM_16", "audio/wav"),
    "mp3": ("MP3", None, "audio/mpeg"),
    "flac": ("FLAC", "PCM_16", "audio/flac"),
    "opus": ("OGG", "OPUS", "audio/ogg"),
}


def encode(wave: np.ndarray, rate: int, fmt: str) -> tuple[bytes, str]:
    container, subtype, mime = FORMATS[fmt]
    out = io.BytesIO()
    sf.write(out, wave, rate, format=container, subtype=subtype)
    return out.getvalue(), mime
