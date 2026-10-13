"""Loads a Qwen3-TTS model on demand and makes speech with it, one request at a time."""

import gc
import threading
import time

import numpy as np

from .catalog import SPEAKERS


def pick_device(torch) -> str:
    """CUDA, then Apple's GPU (MPS), then the CPU. `QWEN_TTS_DEVICE` overrides it."""
    if torch.cuda.is_available():
        return "cuda:0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def pick_dtype(torch, device: str):
    # float16 overflows to NaN on Apple's GPU ("probability tensor contains inf or nan"),
    # so MPS uses bfloat16 like CUDA does. The CPU runs in float32.
    if device.startswith("cuda") or device == "mps":
        return torch.bfloat16
    return torch.float32


def load_kwargs(torch, device: str) -> dict:
    """What `from_pretrained` needs for this device. Off CUDA the model uses the plain
    ("eager") attention: the default one gives bad output on MPS."""
    kwargs = {"device_map": device, "dtype": pick_dtype(torch, device)}
    if not device.startswith("cuda"):
        kwargs["attn_implementation"] = "eager"
    return kwargs


class Engine:
    def __init__(self, models_path, device: str | None = None, idle_seconds: float = 600):
        self._path = models_path  # callable: model id -> folder
        self._device = device
        self._idle = idle_seconds
        self._lock = threading.Lock()
        self._model = None
        self._model_id: str | None = None
        self._last_used = 0.0

    @property
    def loaded(self) -> str | None:
        return self._model_id

    @property
    def device(self) -> str | None:
        return self._device

    def _load(self, model_id: str) -> None:
        import torch  # imported here: it is heavy, and the tests stub the engine out
        from qwen_tts import Qwen3TTSModel

        self.unload()
        device = self._device or pick_device(torch)
        self._model = Qwen3TTSModel.from_pretrained(
            str(self._path(model_id)), **load_kwargs(torch, device)
        )
        self._device, self._model_id = device, model_id

    def unload(self) -> None:
        self._model, self._model_id = None, None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except ImportError:
            pass

    def unload_if_idle(self) -> None:
        with self._lock:
            if self._model is not None and time.monotonic() - self._last_used > self._idle:
                self.unload()

    def synthesize(
        self, model_id: str, text: str, speaker: str, language: str, instructions: str | None
    ) -> tuple[np.ndarray, int]:
        with self._lock:
            if self._model_id != model_id:
                self._load(model_id)
            kwargs = {"instruct": instructions} if instructions else {}
            waves, rate = self._model.generate_custom_voice(
                text=text, language=language, speaker=SPEAKERS[speaker], **kwargs
            )
            self._last_used = time.monotonic()
            return waves[0], rate
