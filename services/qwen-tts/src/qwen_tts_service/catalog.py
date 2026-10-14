"""The models this service will download. Only these: the service never fetches an arbitrary repo."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CatalogModel:
    #: The Hugging Face repo. It is also the `model` a speech request names.
    id: str
    label: str
    #: A pinned commit, so an upstream change can't alter what users download.
    revision: str
    #: Every file the model needs at that revision, with its size in bytes (from the Hugging Face
    #: tree API). A folder of model files is checked against this without any network.
    files: tuple[tuple[str, int], ...]
    license: str
    #: Whether the model follows delivery instructions ("calm and warm").
    instructions: bool

    @property
    def size_bytes(self) -> int:
        """The total download, for showing the size before the file list is fetched."""
        return sum(size for _, size in self.files)


_SHARED = (
    ("config.json", 4908),
    ("generation_config.json", 245),
    ("merges.txt", 1671839),
    ("preprocessor_config.json", 127),
    ("speech_tokenizer/config.json", 2336),
    ("speech_tokenizer/configuration.json", 76),
    ("speech_tokenizer/model.safetensors", 682293092),
    ("speech_tokenizer/preprocessor_config.json", 234),
    ("tokenizer_config.json", 7344),
    ("vocab.json", 2776833),
)

CATALOG: dict[str, CatalogModel] = {
    m.id: m
    for m in (
        CatalogModel(
            id="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            label="Qwen3-TTS 0.6B",
            revision="85e237c12c027371202489a0ec509ded67b5e4b5",
            files=(*_SHARED, ("model.safetensors", 1811626576)),
            license="Apache-2.0",
            instructions=True,
        ),
        CatalogModel(
            id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
            label="Qwen3-TTS 1.7B",
            revision="0c0e3051f131929182e2c023b9537f8b1c68adfe",
            files=(*_SHARED, ("model.safetensors", 3833402552)),
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
