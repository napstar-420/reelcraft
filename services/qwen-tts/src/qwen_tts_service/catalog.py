"""The models this service will download. Only these: the service never fetches an arbitrary repo."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CatalogModel:
    #: The Hugging Face repo. It is also the `model` a speech request names.
    id: str
    label: str
    #: A pinned commit, so an upstream change can't alter what users download.
    revision: str
    #: Total download in bytes, for showing the size before the file list is fetched.
    size_bytes: int
    license: str
    #: Whether the model follows delivery instructions ("calm and warm").
    instructions: bool


CATALOG: dict[str, CatalogModel] = {
    m.id: m
    for m in (
        CatalogModel(
            id="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            label="Qwen3-TTS 0.6B",
            revision="85e237c12c027371202489a0ec509ded67b5e4b5",
            size_bytes=2_493_919_668,
            license="Apache-2.0",
            instructions=False,
        ),
        CatalogModel(
            id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
            label="Qwen3-TTS 1.7B",
            revision="0c0e3051f131929182e2c023b9537f8b1c68adfe",
            size_bytes=4_617_449_338,
            license="Apache-2.0",
            instructions=True,
        ),
    )
}

#: The CustomVoice speakers (lowercase id -> the name the model wants).
SPEAKERS: dict[str, str] = {
    s.lower(): s
    for s in (
        "Vivian",
        "Serena",
        "Uncle_Fu",
        "Dylan",
        "Eric",
        "Ryan",
        "Aiden",
        "Ono_Anna",
        "Sohee",
    )
}

LANGUAGES = (
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
)
