"""Using model files the user already has: checked against the catalog, recorded, never touched."""

import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from conftest import CONFIG, SMALL, WEIGHTS
from qwen_tts_service.app import create_app
from qwen_tts_service.catalog import CATALOG
from qwen_tts_service.store import LINKS, MARKER, StoreError

WEIGHTS_FILE = "speech_tokenizer/model.safetensors"


@pytest.fixture(autouse=True)
def tiny_manifest(monkeypatch):
    """The 0.6B model with a two-file manifest the size of the fake hub's files."""
    files = (("config.json", len(CONFIG)), (WEIGHTS_FILE, len(WEIGHTS)))
    monkeypatch.setitem(CATALOG, SMALL, replace(CATALOG[SMALL], files=files))


@pytest.fixture
def folder(tmp_path):
    """A folder a user downloaded by hand, with their own extra file in it."""
    path = tmp_path / "my-downloads" / "qwen"
    (path / "speech_tokenizer").mkdir(parents=True)
    (path / "config.json").write_bytes(CONFIG)
    (path / WEIGHTS_FILE).write_bytes(WEIGHTS)
    (path / "notes.txt").write_text("mine")
    return path


def snapshot(path):
    return {str(p.relative_to(path)): p.stat().st_size for p in sorted(path.rglob("*")) if p.is_file()}


def test_linking_a_complete_folder_makes_the_model_ready_in_place(store, folder):
    before = snapshot(folder)
    store.link(SMALL, str(folder))
    assert store.is_ready(SMALL) and store.path(SMALL) == folder
    status = store.status(SMALL)
    assert status["state"] == "ready" and status["linkedPath"] == str(folder)
    assert json.loads((store.root / LINKS).read_text())[SMALL]["path"] == str(folder)
    assert snapshot(folder) == before  # nothing written into the user's folder, no marker
    assert not (folder / MARKER).exists()


def test_a_file_of_the_wrong_size_is_refused_and_named(store, folder):
    (folder / WEIGHTS_FILE).write_bytes(b"short")
    with pytest.raises(StoreError) as error:
        store.link(SMALL, str(folder))
    assert error.value.status == 400
    assert "speech_tokenizer/model.safetensors is 5 bytes" in error.value.message
    assert not store.is_ready(SMALL) and not (store.root / LINKS).exists()


def test_a_missing_file_is_refused_and_named(store, folder):
    (folder / "config.json").unlink()
    with pytest.raises(StoreError, match="config.json is missing"):
        store.link(SMALL, str(folder))


@pytest.mark.parametrize("path,message", [("relative/dir", "full path"), ("/no/such/dir", "no folder")])
def test_a_path_that_is_not_a_real_folder_is_refused(store, path, message):
    with pytest.raises(StoreError, match=message):
        store.link(SMALL, path)


def test_deleting_a_linked_model_forgets_the_link_and_keeps_the_folder(store, folder):
    before = snapshot(folder)
    store.link(SMALL, str(folder))
    store.delete(SMALL)
    assert snapshot(folder) == before
    assert not store.is_ready(SMALL) and store.status(SMALL)["state"] == "not_downloaded"
    assert store.path(SMALL) == store.managed_path(SMALL)


def test_a_linked_folder_that_loses_a_file_stops_being_ready(store, folder):
    store.link(SMALL, str(folder))
    (folder / WEIGHTS_FILE).unlink()
    assert not store.is_ready(SMALL)
    assert store.status(SMALL)["state"] == "not_downloaded"


def test_downloading_after_a_broken_link_goes_to_the_managed_folder(store, folder):
    store.link(SMALL, str(folder))
    (folder / WEIGHTS_FILE).unlink()
    store.start(SMALL)  # the user chose to download
    assert store.is_ready(SMALL)
    assert store.path(SMALL) == store.managed_path(SMALL)
    assert (store.managed_path(SMALL) / WEIGHTS_FILE).read_bytes() == WEIGHTS
    assert not (folder / WEIGHTS_FILE).exists()  # the user's folder was not refilled


def test_a_symlink_made_by_hand_is_removed_not_followed(store, folder):
    store.managed_path(SMALL).parent.mkdir(parents=True, exist_ok=True)
    store.managed_path(SMALL).symlink_to(folder, target_is_directory=True)
    (folder / MARKER).write_text(json.dumps({"revision": CATALOG[SMALL].revision}))
    assert store.is_ready(SMALL)  # how the first version of this feature was set up by hand
    before = snapshot(folder)
    store.delete(SMALL)
    assert not store.managed_path(SMALL).exists() and not store.managed_path(SMALL).is_symlink()
    assert snapshot(folder) == before


def test_a_download_in_progress_blocks_linking(store, folder):
    from qwen_tts_service import store as store_module

    store._progress[SMALL] = store_module.Progress(state="downloading")
    with pytest.raises(StoreError) as error:
        store.link(SMALL, str(folder))
    assert error.value.status == 409


class StubEngine:
    loaded = None

    def health(self):
        return {"device": "cpu", "deviceLabel": "CPU", "reason": None, "ready": True}

    def probe(self):
        pass

    def unload(self):
        pass

    def unload_if_idle(self):
        pass


def test_the_link_route(store, folder):
    with TestClient(create_app(store, StubEngine())) as client:
        ok = client.post(f"/v1/models/{SMALL}/link", json={"path": str(folder)})
        assert ok.status_code == 200 and ok.json()["state"] == "ready"
        assert ok.json()["linkedPath"] == str(folder)
        (folder / "config.json").unlink()
        client.delete(f"/v1/models/{SMALL}")
        bad = client.post(f"/v1/models/{SMALL}/link", json={"path": str(folder)})
        assert bad.status_code == 400 and "config.json is missing" in bad.json()["error"]["message"]
        assert client.post("/v1/models/nope/other/link", json={"path": "/x"}).status_code == 404
