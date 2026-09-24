"""Chat with your documents: index folders of PDFs, Word files and notes, then search them by meaning.

Text is split into chunks and turned into embeddings by a small Ollama model
(nomic-embed-text by default), all stored locally in data/knowledge/.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from . import files, store, web

INDEX_DIR = store.DATA_DIR / "knowledge"
CHUNKS_FILE = INDEX_DIR / "chunks.json"
VECTORS_FILE = INDEX_DIR / "vectors.npy"
DOC_EXT = {".txt", ".md", ".markdown", ".pdf", ".docx", ".html", ".htm", ".csv", ".rtf", ".json", ".log", ".py", ".js", ".ts"}
CHUNK = 900
OVERLAP = 150
MAX_FILE_MB = 25

_lock = threading.Lock()
status: dict[str, Any] = {"running": False, "done": 0, "total": 0, "message": "", "error": ""}
_cache: dict[str, Any] = {"mtime": 0, "chunks": [], "vectors": None}


class KnowledgeError(Exception):
    pass


def folders() -> list[Path]:
    return [Path(os.path.expandvars(os.path.expanduser(f))) for f in store.get_settings().get("knowledge_folders") or [] if str(f).strip()]


def extract(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        return "\n".join((page.extract_text() or "") for page in PdfReader(str(path)).pages)
    if ext == ".docx":
        import docx

        doc = docx.Document(str(path))
        return "\n".join(p.text for p in doc.paragraphs)
    text = path.read_text(encoding="utf-8", errors="ignore")
    if ext in (".html", ".htm"):
        return web.extract_text(text)[1]
    return text


def chunk_text(text: str) -> list[str]:
    text = " ".join(text.split())
    if not text:
        return []
    chunks, i = [], 0
    while i < len(text):
        end = min(len(text), i + CHUNK)
        if end < len(text):  # try to break at a sentence end
            cut = text.rfind(". ", i + CHUNK // 2, end)
            if cut > 0:
                end = cut + 1
        chunks.append(text[i:end].strip())
        if end >= len(text):
            break
        i = max(end - OVERLAP, i + 1)
    return chunks


def _embed(client: httpx.Client, ollama: str, model: str, texts: list[str]):
    import numpy as np

    resp = client.post(f"{ollama}/api/embed", json={"model": model, "input": texts}, timeout=300)
    if resp.status_code == 404 or "not found" in resp.text.lower():
        raise KnowledgeError(f"The embedding model '{model}' isn't installed. Download it in Settings → Knowledge.")
    resp.raise_for_status()
    vecs = np.asarray(resp.json()["embeddings"], dtype="float32")
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / np.maximum(norms, 1e-8)


def build(ollama: str) -> None:
    """(Re)index all knowledge folders. Unchanged files are reused. Runs in a background thread."""
    import numpy as np

    with _lock:
        if status["running"]:
            return
        status.update(running=True, done=0, total=0, message="Scanning folders…", error="")
    try:
        model = store.get_settings().get("embed_model") or "nomic-embed-text"
        old_chunks = store._read(CHUNKS_FILE, [])
        old_vecs = np.load(VECTORS_FILE) if VECTORS_FILE.exists() and old_chunks else None
        reuse: dict[tuple[str, float], list[int]] = {}
        for i, c in enumerate(old_chunks):
            if c.get("model") == model:
                reuse.setdefault((c["file"], c["mtime"]), []).append(i)

        paths = []
        for base in folders():
            if not base.is_dir():
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [d for d in dirnames if not d.startswith((".", "$")) and d not in ("node_modules", "__pycache__")]
                for name in filenames:
                    p = Path(dirpath) / name
                    if p.suffix.lower() in DOC_EXT and not name.startswith(("~$", ".")):
                        paths.append(p)
        status["total"] = len(paths)

        chunks: list[dict[str, Any]] = []
        vectors: list[Any] = []
        client = httpx.Client()
        for n, p in enumerate(paths, 1):
            status.update(done=n - 1, message=f"Reading {p.name}")
            try:
                st = p.stat()
                if st.st_size > MAX_FILE_MB * 1024 * 1024:
                    continue
                key = (str(p), st.st_mtime)
                if key in reuse and old_vecs is not None:
                    for i in reuse[key]:
                        chunks.append(old_chunks[i])
                        vectors.append(old_vecs[i])
                    continue
                pieces = chunk_text(extract(p))
            except KnowledgeError:
                raise
            except Exception:
                continue  # unreadable file — skip it
            for start in range(0, len(pieces), 32):
                batch = pieces[start:start + 32]
                vecs = _embed(client, ollama, model, batch)
                for text, vec in zip(batch, vecs):
                    chunks.append({"file": str(p), "mtime": st.st_mtime, "text": text, "model": model})
                    vectors.append(vec)
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        store._write(CHUNKS_FILE, chunks)
        np.save(VECTORS_FILE, np.asarray(vectors, dtype="float32") if vectors else np.zeros((0, 1), dtype="float32"))
        _cache["mtime"] = 0
        files_count = len({c["file"] for c in chunks})
        status.update(done=len(paths), message=f"Ready — {files_count} documents, {len(chunks)} passages indexed", indexed_at=time.time())
    except KnowledgeError as exc:
        status.update(error=str(exc), message="")
    except Exception as exc:
        status.update(error=f"Indexing failed: {exc}", message="")
    finally:
        status["running"] = False


def start_build(ollama: str) -> None:
    threading.Thread(target=build, args=(ollama,), daemon=True, name="athena-index").start()


def _load():
    import numpy as np

    mtime = VECTORS_FILE.stat().st_mtime if VECTORS_FILE.exists() else 0
    if mtime != _cache["mtime"]:
        _cache["chunks"] = store._read(CHUNKS_FILE, [])
        _cache["vectors"] = np.load(VECTORS_FILE) if mtime else None
        _cache["mtime"] = mtime
    return _cache["chunks"], _cache["vectors"]


def search(ollama: str, query: str, k: int = 6) -> dict[str, Any]:
    import numpy as np

    chunks, vectors = _load()
    if not chunks or vectors is None or not len(vectors):
        return {"error": "No documents indexed yet. Add folders in Settings → Knowledge and press 'Index now'."}
    model = chunks[0].get("model") or store.get_settings().get("embed_model")
    with httpx.Client() as client:
        q = _embed(client, ollama, model, [query])[0]
    scores = vectors @ q
    best = np.argsort(-scores)[: max(1, min(int(k), 12))]
    results = []
    for i in best:
        c = chunks[int(i)]
        results.append({"file": files.pretty(Path(c["file"])), "score": round(float(scores[i]), 3), "text": c["text"]})
    return {"query": query, "results": results}


def summary() -> dict[str, Any]:
    chunks = store._read(CHUNKS_FILE, [])
    return {**status, "documents": len({c["file"] for c in chunks}), "passages": len(chunks),
            "folders": [str(f) for f in folders()]}
