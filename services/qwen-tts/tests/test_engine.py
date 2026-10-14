import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from qwen_tts_service import engine as engine_module
from qwen_tts_service.engine import (
    Engine,
    device_label,
    load_kwargs,
    pick_dtype,
    plan_device,
)

SMALL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
GB = 1e9


def fake_torch(cuda=False, mps=False, free=16 * GB, bf16=True, mps_bf16=True):
    def ones(*_args, **_kwargs):
        if not mps_bf16:
            raise RuntimeError("bfloat16 is not supported on this device")

    return SimpleNamespace(
        bfloat16="bf16",
        float16="fp16",
        float32="fp32",
        ones=ones,
        version=SimpleNamespace(cuda="13.0" if cuda else None),
        cuda=SimpleNamespace(
            is_available=lambda: cuda,
            mem_get_info=lambda: (free, 24 * GB),
            is_bf16_supported=lambda: bf16,
            get_device_name=lambda _index: "NVIDIA Test GPU",
            empty_cache=lambda: None,
        ),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
        mps=SimpleNamespace(empty_cache=lambda: None),
    )


SIZE = 2_493_919_668


class TestPlanDevice:
    def test_prefers_cuda_then_mps_then_cpu(self):
        assert plan_device(fake_torch(cuda=True, mps=True), SIZE) == ("cuda:0", None)
        assert plan_device(fake_torch(mps=True), SIZE) == ("mps", None)
        assert plan_device(fake_torch(), SIZE) == ("cpu", "No compatible GPU found")

    def test_falls_back_to_the_cpu_when_the_gpu_has_too_little_free_memory(self):
        device, reason = plan_device(fake_torch(cuda=True, free=2 * GB), SIZE)
        assert device == "cpu"
        assert "Not enough free GPU memory" in reason and "2.0 GB free" in reason

    def test_says_when_pytorch_was_installed_without_gpu_support(self, monkeypatch):
        monkeypatch.setattr(engine_module.shutil, "which", lambda _name: "/usr/bin/nvidia-smi")
        device, reason = plan_device(fake_torch(), SIZE)
        assert device == "cpu" and "without GPU support" in reason and "Reinstall" in reason


class TestPickDtype:
    def test_cuda_uses_bfloat16_only_where_supported(self):
        assert pick_dtype(fake_torch(cuda=True, bf16=True), "cuda:0") == "bf16"
        assert pick_dtype(fake_torch(cuda=True, bf16=False), "cuda:0") == "fp32"

    def test_mps_uses_bfloat16_and_never_float16(self):
        # float16 overflows to NaN on Apple's GPU and the model fails mid-sentence.
        assert pick_dtype(fake_torch(mps=True), "mps") == "bf16"
        assert pick_dtype(fake_torch(mps=True, mps_bf16=False), "mps") == "fp32"

    def test_the_cpu_uses_float32(self):
        assert pick_dtype(fake_torch(), "cpu") == "fp32"


@pytest.mark.parametrize(
    "device,eager",
    [("cuda:0", False), ("mps", True), ("cpu", True)],
)
def test_loads_each_device_the_way_that_works_on_it(device, eager):
    kwargs = load_kwargs(fake_torch(cuda=True, mps=True), device)
    assert kwargs["device_map"] == device
    assert kwargs.get("attn_implementation") == ("eager" if eager else None)


def test_labels_the_device_for_people():
    t = fake_torch(cuda=True)
    assert device_label(t, "cuda:0") == "NVIDIA Test GPU (CUDA)"
    assert device_label(t, "mps") == "Apple GPU (MPS)"
    assert device_label(t, "cpu") == "CPU"


class FakeModel:
    """Stands in for Qwen3TTSModel: records where each load went, and can fail on a device."""

    loads: list[str] = []
    fail_load_on: set[str] = set()
    fail_generate_on: set[str] = set()

    def __init__(self, device):
        self.device = device

    @classmethod
    def from_pretrained(cls, _folder, device_map, **_kwargs):
        cls.loads.append(device_map)
        if device_map in cls.fail_load_on:
            raise RuntimeError("CUDA out of memory\nmore detail")
        return cls(device_map)

    def generate_custom_voice(self, **_kwargs):
        if self.device in self.fail_generate_on:
            raise RuntimeError("CUDA error: device-side assert triggered\nmore detail")
        return [np.zeros(10, dtype=np.float32)], 24000


@pytest.fixture
def install(monkeypatch):
    """Puts a fake torch and qwen_tts where the engine imports them from."""

    def _install(**torch_options):
        FakeModel.loads = []
        FakeModel.fail_load_on = set()
        FakeModel.fail_generate_on = set()
        monkeypatch.setitem(sys.modules, "torch", fake_torch(**torch_options))
        monkeypatch.setitem(sys.modules, "qwen_tts", SimpleNamespace(Qwen3TTSModel=FakeModel))

    return _install


def new_engine(device=None):
    return Engine(lambda model_id: Path("/models") / model_id, device=device)


def speak(engine):
    return engine.synthesize(SMALL, "Hello", "ryan", "English", None)


class TestEngine:
    def test_probe_reports_the_device_before_any_model_is_loaded(self, install):
        install(cuda=True)
        engine = new_engine()
        assert engine.health()["ready"] is False and engine.health()["reason"] == "checking"
        engine.probe()
        assert engine.health() == {
            "device": "cuda:0",
            "deviceLabel": "NVIDIA Test GPU (CUDA)",
            "reason": None,
            "ready": True,
        }
        assert FakeModel.loads == []

    def test_probe_without_pytorch_says_so(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "torch", None)  # makes `import torch` fail
        engine = new_engine()
        engine.probe()
        assert engine.health()["reason"] == "PyTorch is not installed"
        assert engine.health()["ready"] is True

    def test_a_forced_device_is_used_and_reported(self, install):
        install(cuda=True)
        engine = new_engine(device="cpu")
        speak(engine)
        assert FakeModel.loads == ["cpu"]
        assert engine.health()["reason"] == "Set by QWEN_TTS_DEVICE"

    def test_a_gpu_that_fails_to_load_falls_back_to_the_cpu(self, install):
        install(cuda=True)
        FakeModel.fail_load_on = {"cuda:0"}
        engine = new_engine()
        speak(engine)
        assert FakeModel.loads == ["cuda:0", "cpu"]
        health = engine.health()
        assert health["device"] == "cpu" and health["reason"] == "GPU failed: CUDA out of memory"

    def test_a_gpu_that_fails_mid_request_is_retried_once_on_the_cpu_and_left_alone(self, install):
        install(cuda=True)
        FakeModel.fail_generate_on = {"cuda:0"}
        engine = new_engine()
        wave, rate = speak(engine)
        assert rate == 24000 and len(wave) == 10
        assert FakeModel.loads == ["cuda:0", "cpu"]
        assert engine.health()["device"] == "cpu"
        engine.unload()
        speak(engine)  # a later load does not try the GPU again
        assert FakeModel.loads == ["cuda:0", "cpu", "cpu"]

    def test_a_cpu_failure_is_not_retried(self, install):
        install()
        FakeModel.fail_generate_on = {"cpu"}
        engine = new_engine()
        with pytest.raises(RuntimeError, match="device-side assert"):
            speak(engine)
        assert FakeModel.loads == ["cpu"]

    def test_a_forced_gpu_that_fails_is_reported_not_hidden(self, install):
        install(cuda=True)
        FakeModel.fail_generate_on = {"cuda:0"}
        engine = new_engine(device="cuda:0")
        with pytest.raises(RuntimeError):
            speak(engine)
        assert FakeModel.loads == ["cuda:0"]
