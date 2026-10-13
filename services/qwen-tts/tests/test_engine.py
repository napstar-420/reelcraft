from types import SimpleNamespace

import pytest

from qwen_tts_service.engine import load_kwargs, pick_device, pick_dtype

torch = SimpleNamespace(bfloat16="bf16", float16="fp16", float32="fp32")


def fake(cuda=False, mps=False):
    return SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: cuda),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
        **vars(torch),
    )


def test_picks_the_fastest_device():
    assert pick_device(fake(cuda=True, mps=True)) == "cuda:0"
    assert pick_device(fake(mps=True)) == "mps"
    assert pick_device(fake()) == "cpu"


@pytest.mark.parametrize(
    "device,dtype,eager",
    [("cuda:0", "bf16", False), ("mps", "bf16", True), ("cpu", "fp32", True)],
)
def test_loads_each_device_the_way_that_works_on_it(device, dtype, eager):
    kwargs = load_kwargs(torch, device)
    assert kwargs["device_map"] == device and kwargs["dtype"] == dtype
    assert kwargs.get("attn_implementation") == ("eager" if eager else None)


def test_mps_never_uses_float16():
    # float16 overflows to NaN on Apple's GPU and the model fails mid-sentence.
    assert pick_dtype(torch, "mps") != "fp16"
