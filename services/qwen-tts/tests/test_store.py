import hashlib

import pytest

from conftest import BIG, CONFIG, SMALL, WEIGHTS
from qwen_tts_service import store as store_module
from qwen_tts_service.store import MARKER, StoreError


def test_a_model_starts_not_downloaded(store):
    assert store.status(SMALL)["state"] == "not_downloaded"
    assert store.status(SMALL)["totalBytes"] == 2_493_919_668


def test_downloads_every_file_and_marks_it_ready(store):
    store.start(SMALL)
    folder = store.path(SMALL)
    assert (folder / "config.json").read_bytes() == CONFIG
    assert (folder / "speech_tokenizer/model.safetensors").read_bytes() == WEIGHTS
    assert not (folder / "README.md").exists()
    assert (folder / MARKER).exists()
    assert store.status(SMALL)["state"] == "ready"
    assert store.is_ready(SMALL) and not store.is_ready(BIG)


def test_resumes_a_partial_file(store, hub):
    part = store.path(SMALL) / "speech_tokenizer/model.safetensors.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(WEIGHTS[:1000])
    store.start(SMALL)
    assert hub.ranges == ["bytes=1000-"]
    assert (store.path(SMALL) / "speech_tokenizer/model.safetensors").read_bytes() == WEIGHTS


def test_a_bad_checksum_fails_the_download_and_keeps_nothing(store, hub):
    hub.sha = hashlib.sha256(b"something else").hexdigest()
    store.start(SMALL)
    status = store.status(SMALL)
    assert status["state"] == "failed" and "checksum" in status["error"]
    assert not store.is_ready(SMALL)
    assert not (store.path(SMALL) / "speech_tokenizer/model.safetensors").exists()


def test_cancel_stops_the_download_without_failing_it(store, hub):
    hub.on_weights = lambda: store.cancel(SMALL)
    store.start(SMALL)
    assert store.status(SMALL)["state"] == "not_downloaded"
    assert not store.is_ready(SMALL)


def test_refuses_when_the_disk_is_too_small(store, monkeypatch):
    class Usage:
        free = 100

    monkeypatch.setattr(store_module.shutil, "disk_usage", lambda _: Usage)
    with pytest.raises(StoreError) as error:
        store.start(SMALL)
    assert error.value.status == 507


def test_only_one_download_at_a_time(store):
    store._progress[BIG] = store_module.Progress(state="downloading")
    with pytest.raises(StoreError) as error:
        store.start(SMALL)
    assert error.value.status == 409
    with pytest.raises(StoreError):
        store.delete(BIG)


def test_delete_removes_the_files(store):
    store.start(SMALL)
    store.delete(SMALL)
    assert not store.path(SMALL).exists()
    assert store.status(SMALL)["state"] == "not_downloaded"


def test_only_catalog_models_are_known(store):
    for call in (store.start, store.cancel, store.delete, store.status):
        with pytest.raises(StoreError) as error:
            call("someone/else-model")
        assert error.value.status == 404
