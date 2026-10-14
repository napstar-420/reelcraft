"""Loads a Qwen3-TTS model on demand and makes speech with it, one request at a time."""

import gc
import shutil
import threading
import time

import numpy as np

from .catalog import CATALOG, SPEAKERS

#: The GPU needs this multiple of the model's size free (weights plus working memory).
VRAM_HEADROOM = 1.3
GB = 1e9


def plan_device(torch, size_bytes: int) -> tuple[str, str | None]:
    """The device to use and, when that is the CPU, why. CUDA, then Apple's GPU (MPS), then the CPU."""
    if torch.cuda.is_available():
        free, _ = torch.cuda.mem_get_info()
        need = size_bytes * VRAM_HEADROOM
        if free < need:
            return "cpu", (
                f"Not enough free GPU memory ({free / GB:.1f} GB free, about {need / GB:.1f} GB needed)"
            )
        return "cuda:0", None
    if torch.backends.mps.is_available():
        return "mps", None
    if getattr(torch.version, "cuda", None) is None and shutil.which("nvidia-smi"):
        return "cpu", (
            "An NVIDIA GPU is present but PyTorch was installed without GPU support. "
            "Use Reinstall for this hardware."
        )
    return "cpu", "No compatible GPU found"


def device_label(torch, device: str) -> str:
    if device.startswith("cuda"):
        return f"{torch.cuda.get_device_name(0)} (CUDA)"
    if device == "mps":
        return "Apple GPU (MPS)"
    return "CPU"


def pick_dtype(torch, device: str):
    # float16 overflows to NaN on Apple's GPU ("probability tensor contains inf or nan"), so MPS
    # uses bfloat16 like CUDA does. A GPU that can't do bfloat16, and the CPU, run in float32.
    if device.startswith("cuda"):
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
    if device == "mps":
        try:
            torch.ones(1, dtype=torch.bfloat16, device="mps")
            return torch.bfloat16
        except Exception:  # noqa: BLE001 - any failure means this Mac can't do bfloat16
            return torch.float32
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
        self._forced = device  # QWEN_TTS_DEVICE
        self._idle = idle_seconds
        self._lock = threading.Lock()
        self._model = None
        self._model_id: str | None = None
        self._last_used = 0.0
        # What /health reports. Until the first probe or load there is nothing to say yet.
        self._device: str | None = None
        self._label: str | None = None
        self._reason: str | None = "checking"
        self._ready = False
        # Set once the GPU failed us: every later load stays on the CPU until the service restarts.
        self._cpu_only: str | None = None

    @property
    def loaded(self) -> str | None:
        return self._model_id

    def health(self) -> dict:
        return {
            "device": self._device,
            "deviceLabel": self._label,
            "reason": self._reason,
            "ready": self._ready,
        }

    def probe(self) -> None:
        """Works out which device will be used without loading a model, so /health can say.
        Runs on a thread at startup: importing torch takes a few seconds."""
        try:
            import torch
        except ImportError:
            self._reason, self._ready = "PyTorch is not installed", True
            return
        try:
            size = min(model.size_bytes for model in CATALOG.values())
            device, reason = self._choose(torch, size)
            if self._model_id is None:  # a load that got there first knows better
                self._set(torch, device, reason)
        finally:
            self._ready = True

    def _choose(self, torch, size_bytes: int) -> tuple[str, str | None]:
        if self._forced:
            return self._forced, "Set by QWEN_TTS_DEVICE"
        if self._cpu_only:
            return "cpu", self._cpu_only
        return plan_device(torch, size_bytes)

    def _set(self, torch, device: str, reason: str | None) -> None:
        self._device, self._reason = device, reason
        self._label = device_label(torch, device)

    def _give_up_on_gpu(self, error: Exception) -> None:
        first_line = (str(error).strip().splitlines() or [type(error).__name__])[0]
        self._cpu_only = f"GPU failed: {first_line[:160]}"

    def _load(self, model_id: str) -> None:
        import torch  # imported here: it is heavy, and the tests stub the engine out
        from qwen_tts import Qwen3TTSModel

        self.unload()
        device, reason = self._choose(torch, CATALOG[model_id].size_bytes)
        folder = str(self._path(model_id))
        try:
            model = Qwen3TTSModel.from_pretrained(folder, **load_kwargs(torch, device))
        except RuntimeError as error:
            if device == "cpu" or self._forced:
                raise
            self._give_up_on_gpu(error)
            self.unload()
            device, reason = "cpu", self._cpu_only
            model = Qwen3TTSModel.from_pretrained(folder, **load_kwargs(torch, device))
        self._model, self._model_id = model, model_id
        self._set(torch, device, reason)
        self._ready = True

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

    def _generate(self, text, speaker, language, instructions) -> tuple[np.ndarray, int]:
        kwargs = {"instruct": instructions} if instructions else {}
        waves, rate = self._model.generate_custom_voice(
            text=text, language=language, speaker=SPEAKERS[speaker], **kwargs
        )
        self._last_used = time.monotonic()
        return waves[0], rate

    def synthesize(
        self, model_id: str, text: str, speaker: str, language: str, instructions: str | None
    ) -> tuple[np.ndarray, int]:
        with self._lock:
            if self._model_id != model_id:
                self._load(model_id)
            try:
                return self._generate(text, speaker, language, instructions)
            except RuntimeError as error:
                # The GPU can fail mid-request (out of memory, a driver fault). Try once more on the
                # CPU, and stay there until the service restarts so it doesn't flip back and forth.
                if self._device == "cpu" or self._forced:
                    raise
                self._give_up_on_gpu(error)
                self._load(model_id)
                return self._generate(text, speaker, language, instructions)
