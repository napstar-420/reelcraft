"""Downloads model weights from Hugging Face into the models directory, with progress, resume and cancel."""

import hashlib
import json
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import httpx

from .catalog import CATALOG, CatalogModel

HF = "https://huggingface.co"
MARKER = ".reelcraft-complete.json"
CHUNK = 1024 * 1024
#: Room left on the disk after the download.
DISK_MARGIN = 1024**3
#: Repo files the model doesn't need.
SKIP = {".gitattributes", "README.md"}


class StoreError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class RepoFile:
    path: str
    size: int
    sha256: str | None  # set for LFS files, whose hash Hugging Face publishes


@dataclass
class Progress:
    state: str = "not_downloaded"  # not_downloaded | downloading | ready | failed
    downloaded: int = 0
    total: int = 0
    error: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)


class ModelStore:
    def __init__(
        self,
        root: Path,
        client_factory: Callable[[], httpx.Client] | None = None,
        run_in_thread: bool = True,
    ):
        self.root = root
        self._client = client_factory or (
            lambda: httpx.Client(follow_redirects=True, timeout=httpx.Timeout(30, read=60))
        )
        self._threaded = run_in_thread
        self._lock = threading.Lock()
        self._progress: dict[str, Progress] = {}
        self._thread: threading.Thread | None = None

    def path(self, model_id: str) -> Path:
        return self.root / model_id.replace("/", "--")

    def model(self, model_id: str) -> CatalogModel:
        try:
            return CATALOG[model_id]
        except KeyError:
            raise StoreError(404, f'There is no model "{model_id}".') from None

    def is_ready(self, model_id: str) -> bool:
        marker = self.path(model_id) / MARKER
        try:
            return json.loads(marker.read_text())["revision"] == self.model(model_id).revision
        except (OSError, ValueError, KeyError):
            return False

    def status(self, model_id: str) -> dict:
        m = self.model(model_id)
        with self._lock:
            p = self._progress.get(model_id)
            live = p if p and p.state in ("downloading", "failed") else None
        if live:
            state, downloaded, total, error = live.state, live.downloaded, live.total, live.error
        elif self.is_ready(model_id):
            state, downloaded, total, error = "ready", m.size_bytes, m.size_bytes, None
        else:
            state, downloaded, total, error = "not_downloaded", 0, m.size_bytes, None
        return {
            "id": m.id,
            "label": m.label,
            "state": state,
            "downloadedBytes": downloaded,
            "totalBytes": total or m.size_bytes,
            "error": error,
            "license": m.license,
            "instructions": m.instructions,
            "freeBytes": self.free_bytes(),
        }

    def free_bytes(self) -> int:
        folder = self.root
        while not folder.exists() and folder != folder.parent:
            folder = folder.parent
        return shutil.disk_usage(folder).free

    def _tree(self, client: httpx.Client, m: CatalogModel) -> list[RepoFile]:
        url = f"{HF}/api/models/{m.id}/tree/{m.revision}?recursive=true"
        try:
            response = client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise StoreError(502, f"Could not list the model's files on Hugging Face: {error}") from error
        return [
            RepoFile(e["path"], int(e["size"]), (e.get("lfs") or {}).get("oid"))
            for e in response.json()
            if e.get("type") == "file" and e["path"] not in SKIP
        ]

    def start(self, model_id: str) -> None:
        m = self.model(model_id)
        if self.is_ready(model_id):
            return
        with self._lock:
            if any(p.state == "downloading" for p in self._progress.values()):
                raise StoreError(409, "Another model is downloading. Wait for it to finish or cancel it.")
        client = self._client()
        files = self._tree(client, m)
        total = sum(f.size for f in files)
        self.root.mkdir(parents=True, exist_ok=True)
        have = sum(
            (self.path(model_id) / (f.path + ".part")).stat().st_size
            for f in files
            if (self.path(model_id) / (f.path + ".part")).exists()
        )
        free = shutil.disk_usage(self.root).free
        if free < total - have + DISK_MARGIN:
            raise StoreError(
                507,
                f"Not enough disk space: {total / 1e9:.1f} GB needed, {free / 1e9:.1f} GB free.",
            )
        progress = Progress(state="downloading", total=total)
        with self._lock:
            self._progress[model_id] = progress
        if self._threaded:
            self._thread = threading.Thread(
                target=self._run, args=(client, m, files, progress), daemon=True
            )
            self._thread.start()
        else:
            self._run(client, m, files, progress)

    def cancel(self, model_id: str) -> None:
        self.model(model_id)
        with self._lock:
            p = self._progress.get(model_id)
        if p and p.state == "downloading":
            p.cancel.set()

    def delete(self, model_id: str) -> None:
        self.model(model_id)
        with self._lock:
            p = self._progress.get(model_id)
            if p and p.state == "downloading":
                raise StoreError(409, "This model is downloading. Cancel the download first.")
            self._progress.pop(model_id, None)
        shutil.rmtree(self.path(model_id), ignore_errors=True)

    def wait(self) -> None:
        if self._thread:
            self._thread.join()

    def _run(self, client: httpx.Client, m: CatalogModel, files: list[RepoFile], p: Progress) -> None:
        folder = self.path(m.id)
        done = 0
        try:
            for f in files:
                self._fetch(client, m, f, folder, p, done)
                done += f.size
            (folder / MARKER).write_text(
                json.dumps({"revision": m.revision, "files": {f.path: f.size for f in files}})
            )
            p.state = "ready"
            with self._lock:
                self._progress.pop(m.id, None)
        except _Cancelled:
            p.state = "not_downloaded"
            with self._lock:
                self._progress.pop(m.id, None)
        except Exception as error:  # noqa: BLE001 - reported to the user as the failure reason
            p.state, p.error = "failed", str(error)
        finally:
            client.close()

    def _fetch(
        self, client: httpx.Client, m: CatalogModel, f: RepoFile, folder: Path, p: Progress, done: int
    ) -> None:
        dest = folder / f.path
        if dest.exists() and dest.stat().st_size == f.size:
            p.downloaded = done + f.size
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        offset = part.stat().st_size if part.exists() else 0
        if offset > f.size:
            part.unlink()
            offset = 0
        if offset < f.size:
            url = f"{HF}/{m.id}/resolve/{m.revision}/{quote(f.path)}"
            headers = {"Range": f"bytes={offset}-"} if offset else {}
            with client.stream("GET", url, headers=headers) as response:
                if response.status_code not in (200, 206):
                    raise RuntimeError(f"Hugging Face answered {response.status_code} for {f.path}.")
                if response.status_code == 200:
                    offset = 0  # the server ignored the range: start the file again
                with part.open("ab" if offset else "wb") as out:
                    written = offset
                    for chunk in response.iter_bytes(CHUNK):
                        if p.cancel.is_set():
                            raise _Cancelled
                        out.write(chunk)
                        written += len(chunk)
                        p.downloaded = done + written
        if part.stat().st_size != f.size:
            part.unlink()
            raise RuntimeError(f"{f.path} came down at the wrong size. Try the download again.")
        if f.sha256 and _sha256(part) != f.sha256:
            part.unlink()
            raise RuntimeError(f"{f.path} failed its checksum. Try the download again.")
        part.replace(dest)
        p.downloaded = done + f.size


class _Cancelled(Exception):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()
