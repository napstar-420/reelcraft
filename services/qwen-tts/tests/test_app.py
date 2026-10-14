import numpy as np
import pytest
from fastapi.testclient import TestClient

from conftest import BIG, SMALL
from qwen_tts_service.app import create_app


class StubEngine:
    loaded = None

    def __init__(self):
        self.calls = []

    def health(self):
        return {"device": "cpu", "deviceLabel": "CPU", "reason": "No compatible GPU found", "ready": True}

    def probe(self):
        pass

    def synthesize(self, model_id, text, speaker, language, instructions):
        self.calls.append((model_id, text, speaker, language, instructions))
        return np.zeros(2400, dtype=np.float32), 24000

    def unload(self):
        self.loaded = None

    def unload_if_idle(self):
        pass


@pytest.fixture
def engine():
    return StubEngine()


@pytest.fixture
def client(store, engine):
    with TestClient(create_app(store, engine)) as c:
        yield c


def speak(client, **body):
    return client.post("/v1/audio/speech", json={"model": SMALL, "input": "Hello", **body})


def test_lists_both_models_and_the_voices(client):
    models = client.get("/v1/models").json()["data"]
    assert [m["id"] for m in models] == [SMALL, BIG]
    assert {m["state"] for m in models} == {"not_downloaded"}
    assert "vivian" in client.get("/v1/audio/voices").json()["voices"]


def test_health_identifies_the_service_and_reports_the_device(client):
    health = client.get("/health").json()
    assert health["status"] == "ok" and health["service"] == "reelcraft-qwen-tts"
    assert health["api"] == 1 and isinstance(health["pid"], int)
    assert health["device"] == "cpu" and health["reason"] == "No compatible GPU found"
    assert health["ready"] is True and health["loadedModel"] is None


def test_speech_needs_the_model_to_be_downloaded(client):
    response = speak(client)
    assert response.status_code == 409
    assert "Download it in Reelcraft" in response.json()["error"]["message"]


def test_download_then_speak(client, engine):
    assert client.post(f"/v1/models/{SMALL}/download").status_code == 202
    assert client.get("/v1/models").json()["data"][0]["state"] == "ready"
    response = speak(client, voice="Ryan", language="english", response_format="wav")
    assert response.status_code == 200
    assert response.content[:4] == b"RIFF" and response.headers["content-type"] == "audio/wav"
    assert engine.calls == [(SMALL, "Hello", "ryan", "English", None)]


@pytest.mark.parametrize("model", [SMALL, BIG])
def test_delivery_instructions_reach_either_model(client, engine, model):
    client.post(f"/v1/models/{model}/download")
    speak(client, model=model, instructions="calm and warm")
    assert engine.calls[-1][4] == "calm and warm"


@pytest.mark.parametrize("body", [{"voice": "nobody"}, {"language": "Klingon"}])
def test_rejects_an_unknown_voice_or_language(client, body):
    client.post(f"/v1/models/{SMALL}/download")
    response = speak(client, **body)
    assert response.status_code == 400
    assert "Choose one of" in response.json()["error"]["message"]


def test_delete_and_unknown_models(client):
    client.post(f"/v1/models/{SMALL}/download")
    assert client.delete(f"/v1/models/{SMALL}").json()["state"] == "not_downloaded"
    assert client.post("/v1/models/x/y/download").status_code == 404
