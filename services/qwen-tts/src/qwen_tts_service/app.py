"""The HTTP API: model downloads for the Reelcraft app, and an OpenAI-style speech route."""

import asyncio
import contextlib
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .audio import encode
from .catalog import CATALOG, LANGUAGES, SPEAKERS
from .engine import Engine
from .store import ModelStore, StoreError


class SpeechRequest(BaseModel):
    model: str
    input: str = Field(min_length=1, max_length=5000)
    voice: str = "vivian"
    response_format: Literal["wav", "mp3", "flac", "opus"] = "wav"
    language: str = "Auto"
    instructions: str | None = Field(default=None, max_length=500)


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": "error", "code": status}}, status_code=status)


def create_app(store: ModelStore, engine: Engine) -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        async def sweep():
            while True:
                await asyncio.sleep(60)
                await asyncio.to_thread(engine.unload_if_idle)

        task = asyncio.create_task(sweep())
        yield
        task.cancel()

    app = FastAPI(title="Reelcraft Qwen3-TTS service", lifespan=lifespan)

    @app.exception_handler(StoreError)
    async def store_error(_: Request, error: StoreError):
        return _error(error.status, error.message)

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "device": engine.device,
            "loadedModel": engine.loaded,
            "modelsDir": str(store.root),
        }

    @app.get("/v1/models")
    def models():
        return {"object": "list", "data": [store.status(model_id) for model_id in CATALOG]}

    @app.post("/v1/models/{model_id:path}/download", status_code=202)
    def download(model_id: str):
        store.start(model_id)
        return store.status(model_id)

    @app.post("/v1/models/{model_id:path}/cancel")
    def cancel(model_id: str):
        store.cancel(model_id)
        return store.status(model_id)

    @app.delete("/v1/models/{model_id:path}")
    def delete(model_id: str):
        store.model(model_id)
        if engine.loaded == model_id:
            engine.unload()
        store.delete(model_id)
        return store.status(model_id)

    @app.get("/v1/audio/voices")
    def voices():
        return {"voices": list(SPEAKERS)}

    @app.post("/v1/audio/speech")
    def speech(req: SpeechRequest):
        store.model(req.model)
        if not store.is_ready(req.model):
            return _error(409, f"{req.model} isn't downloaded. Download it in Reelcraft first.")
        voice = req.voice.lower()
        if voice not in SPEAKERS:
            return _error(400, f'Unknown voice "{req.voice}". Choose one of: {", ".join(SPEAKERS)}.')
        language = next((l for l in LANGUAGES if l.lower() == req.language.lower()), None)
        if language is None:
            return _error(400, f'Unknown language "{req.language}". Choose one of: {", ".join(LANGUAGES)}.')
        wave, rate = engine.synthesize(
            req.model, req.input, voice, language, req.instructions if CATALOG[req.model].instructions else None
        )
        body, mime = encode(wave, rate, req.response_format)
        return Response(body, media_type=mime)

    return app
